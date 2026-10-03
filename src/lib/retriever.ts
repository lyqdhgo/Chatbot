/**
 * 轻量 RAG 检索器。
 *
 * 职责：
 *   1. 把知识切片向量化并常驻内存（知识库文件改动后自动重建）
 *   2. 对用户问题做余弦相似度召回 Top-K
 *   3. 相似度低于阈值时判定为「未命中」，交给上层走转人工兜底
 *
 * 注意：所有向量都缓存在服务端进程内存里，前端拿不到知识库原文。
 */

import { getEmbeddingConfig, getRagConfig } from './config';
import {
  cosineSimilarity,
  createEmbeddingBackend,
  createLocalEmbeddingBackend,
  type EmbeddingBackend,
} from './embeddings';
import { getKnowledgeSignature, loadChunks } from './knowledge';
import type { KnowledgeChunk, RetrievedSource } from './types';

/** 一条召回结果 */
export interface RetrievalMatch {
  chunk: KnowledgeChunk;
  score: number;
}

/** 检索结果 */
export interface RetrievalResult {
  /** 命中的切片及分数，已按分数降序 */
  matches: RetrievalMatch[];
  /** 转换成可以安全下发给前端的结构（只含预览，不含全文） */
  sources: RetrievedSource[];
  /** 是否未命中（含知识库为空的情况） */
  miss: boolean;
  /** 最高分，用于调试阈值 */
  topScore: number;
  /** 实际使用的 embedding 后端名 */
  backendName: string;
}

/** 内存索引 */
interface KnowledgeIndex {
  signature: string;
  chunks: KnowledgeChunk[];
  vectors: number[][];
  backend: EmbeddingBackend;
  backendName: string;
}

let cachedIndex: KnowledgeIndex | null = null;
/** 正在构建中的索引，用于合并并发请求，避免同时重复构建 */
let building: Promise<KnowledgeIndex> | null = null;

/**
 * 索引指纹 = 知识库文件指纹 + 检索相关配置 + embedding 后端。
 * 任意一项变化都会触发重建。
 */
function indexSignature(): string {
  const rag = getRagConfig();
  const embedding = getEmbeddingConfig();
  return [
    getKnowledgeSignature(),
    `k${rag.topK}`,
    `cs${rag.chunkSize}`,
    `co${rag.chunkOverlap}`,
    `e${embedding.provider}:${embedding.model}`,
  ].join('|');
}

/** 真正构建索引：切块 → fit → 批量向量化 */
async function buildIndex(signature: string): Promise<KnowledgeIndex> {
  const chunks = loadChunks();
  const corpus = chunks.map((chunk) => chunk.fullText);

  let backend = createEmbeddingBackend();
  let vectors: number[][];

  try {
    await backend.fit(corpus);
    vectors = await backend.embedBatch(corpus);
  } catch (error) {
    // 远程 embedding 不可用时自动降级到本地向量，保证检索功能不整体挂掉
    console.warn(
      `[retriever] ${backend.name} 构建失败，降级为本地 embedding：`,
      error instanceof Error ? error.message : error,
    );
    backend = createLocalEmbeddingBackend();
    await backend.fit(corpus);
    vectors = await backend.embedBatch(corpus);
  }

  return {
    signature,
    chunks,
    vectors,
    backend,
    backendName: backend.name,
  };
}

/** 获取（必要时重建）索引 */
async function getIndex(): Promise<KnowledgeIndex> {
  const signature = indexSignature();

  if (cachedIndex && cachedIndex.signature === signature) {
    return cachedIndex;
  }

  if (building) return building;

  building = buildIndex(signature)
    .then((index) => {
      cachedIndex = index;
      return index;
    })
    .finally(() => {
      building = null;
    });

  return building;
}

/**
 * 预热索引。健康检查和服务启动时调用，避免第一条用户消息等太久。
 */
export async function warmupRetriever(): Promise<{
  files: number;
  chunks: number;
  backend: string;
}> {
  const index = await getIndex();
  return {
    files: new Set(index.chunks.map((chunk) => chunk.file)).size,
    chunks: index.chunks.length,
    backend: index.backendName,
  };
}

/** 把切片全文截成预览，避免下发给前端的内容过长 */
function toPreview(text: string, max = 160): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

export interface RetrieveOptions {
  /** 忽略阈值，返回纯 Top-K（用于阈值调参与自测） */
  ignoreThreshold?: boolean;
  /** 覆盖默认的 Top-K */
  topK?: number;
}

/**
 * 对用户问题做检索。
 *
 * 命中判定规则：Top-K 里只要有一条分数 >= 阈值就算命中；
 * 一条都没有则 miss = true，上层会走「这点我确认一下 + 转人工」分支。
 */
export async function retrieve(query: string, options: RetrieveOptions = {}): Promise<RetrievalResult> {
  const rag = getRagConfig();
  const index = await getIndex();
  const empty = index.chunks.length === 0;

  if (empty) {
    return { matches: [], sources: [], miss: true, topScore: 0, backendName: index.backendName };
  }

  const [queryVector] = await index.backend.embedBatch([query]);

  const scored: RetrievalMatch[] = index.chunks.map((chunk, i) => ({
    chunk,
    score: cosineSimilarity(queryVector, index.vectors[i]),
  }));

  scored.sort((a, b) => b.score - a.score);

  const topScore = scored[0]?.score ?? 0;
  const limit = options.topK ?? rag.topK;

  const picked = options.ignoreThreshold
    ? scored.slice(0, limit)
    : scored.slice(0, limit).filter((item) => item.score >= rag.scoreThreshold);

  return {
    matches: picked,
    sources: picked.map((item) => ({
      id: item.chunk.id,
      title: item.chunk.title,
      file: item.chunk.file,
      score: Number(item.score.toFixed(4)),
      preview: toPreview(item.chunk.text),
    })),
    miss: picked.length === 0,
    topScore: Number(topScore.toFixed(4)),
    backendName: index.backendName,
  };
}

/**
 * 把命中的切片拼成注入 system prompt 的知识块。
 * 带上编号和标题，方便模型引用，也方便人工排查答案来源。
 */
export function formatKnowledgeBlock(matches: RetrievalMatch[]): string {
  return matches
    .map((match, i) => {
      const { title, file, text } = match.chunk;
      return `[片段 ${i + 1}]（来源：${file} · ${title} · 相似度 ${match.score.toFixed(3)}）\n${text}`;
    })
    .join('\n\n---\n\n');
}

/** 知识库概况，给 /api/health 用 */
export async function getKnowledgeStats(): Promise<{ files: number; chunks: number; backend: string }> {
  const index = await getIndex();
  const files = new Set(index.chunks.map((chunk) => chunk.file));
  return { files: files.size, chunks: index.chunks.length, backend: index.backendName };
}

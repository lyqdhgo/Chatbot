/**
 * 知识库加载与切片。
 *
 * 流程：读取 ./knowledge 下的 .md / .txt → 按标题切成小节 → 小节内按段落合并成
 * 约 CHUNK_SIZE 字的切片（相邻切片保留 CHUNK_OVERLAP 字重叠）→ 返回 KnowledgeChunk[]。
 */

import fs from 'node:fs';
import path from 'node:path';
import { getKnowledgeDir, getRagConfig } from './config';
import type { KnowledgeChunk } from './types';

/** 支持的知识库文件扩展名 */
const SUPPORTED_EXT = new Set(['.md', '.txt']);

/** 知识库目录的绝对路径 */
function knowledgeRoot(): string {
  return path.join(process.cwd(), getKnowledgeDir());
}

/**
 * 递归收集知识库目录下的所有 .md / .txt 文件。
 * 目录不存在时返回空数组（而不是抛错），这样没放知识库也能正常启动。
 */
function collectFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];

  const result: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    // 跳过隐藏文件和 node_modules
    if (entry.name.startsWith('.')) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      result.push(...collectFiles(full));
    } else if (SUPPORTED_EXT.has(path.extname(entry.name).toLowerCase())) {
      result.push(full);
    }
  }
  return result;
}

/**
 * 计算知识库的「指纹」：所有文件的路径 + mtime + 大小。
 * 指纹变化即说明知识库被改动过，缓存需要重建。
 */
export function getKnowledgeSignature(): string {
  const files = collectFiles(knowledgeRoot()).sort();
  return files
    .map((f) => {
      const stat = fs.statSync(f);
      return `${path.relative(knowledgeRoot(), f)}:${stat.mtimeMs}:${stat.size}`;
    })
    .join('|');
}

/** 一个待切片的原始小节（由标题划分出来） */
interface RawSection {
  /** 标题路径，如 "价格方案 > 标准版" */
  title: string;
  /** 该小节下的正文（不含标题行） */
  body: string;
}

/**
 * 按 Markdown 标题把文档切成小节，并维护标题层级路径。
 * 对 .txt 文件（没有 # 标题）来说，整篇会被当成一个无标题小节。
 */
function splitByHeading(raw: string, fileTitle: string): RawSection[] {
  const lines = raw.split(/\r?\n/);
  const sections: RawSection[] = [];

  // headingStack[i] 表示当前第 i 级标题的文字
  const headingStack: string[] = [];
  let currentBody: string[] = [];

  const flush = () => {
    const body = currentBody.join('\n').trim();
    const title = headingStack.length > 0 ? headingStack.filter(Boolean).join(' > ') : fileTitle;
    if (body) sections.push({ title, body });
    currentBody = [];
  };

  for (const line of lines) {
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match) {
      // 遇到新标题，先把上一个小节收尾
      flush();
      const level = match[1].length;
      headingStack.length = level; // 截断到当前层级
      headingStack[level - 1] = match[2].trim();
    } else {
      currentBody.push(line);
    }
  }
  flush();

  return sections;
}

/**
 * 把一段长文本按段落合并成若干切片。
 * 相邻切片之间会保留 overlap 个字符的重叠，避免关键信息正好被切断。
 */
function packParagraphs(body: string, chunkSize: number, overlap: number): string[] {
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buffer = '';

  const pushBuffer = () => {
    const text = buffer.trim();
    if (!text) return;
    chunks.push(text);
    // 保留尾部 overlap 个字符作为下一个切片的开头
    buffer = overlap > 0 ? text.slice(-overlap) : '';
  };

  for (const paragraph of paragraphs) {
    // 单个段落就超长时，直接硬切
    if (paragraph.length > chunkSize) {
      pushBuffer();
      let start = 0;
      while (start < paragraph.length) {
        const end = Math.min(start + chunkSize, paragraph.length);
        chunks.push(paragraph.slice(start, end));
        if (end >= paragraph.length) break;
        start = end - overlap;
      }
      buffer = '';
      continue;
    }

    // 加上这一段会超长，就先把当前 buffer 落盘
    if (buffer.length + paragraph.length + 1 > chunkSize && buffer.length > 0) {
      pushBuffer();
    }

    buffer = buffer ? `${buffer}\n${paragraph}` : paragraph;
  }

  pushBuffer();
  return chunks;
}

/** 对单个文件做完整切片 */
function chunkFile(absPath: string): KnowledgeChunk[] {
  const { chunkSize, chunkOverlap } = getRagConfig();
  const fileName = path.relative(knowledgeRoot(), absPath).split(path.sep).join('/');
  const fileTitle = path.basename(fileName, path.extname(fileName));
  const raw = fs.readFileSync(absPath, 'utf8');

  const sections = splitByHeading(raw, fileTitle);
  const chunks: KnowledgeChunk[] = [];

  sections.forEach((section, sectionIndex) => {
    const pieces = packParagraphs(section.body, chunkSize, chunkOverlap);

    pieces.forEach((text, pieceIndex) => {
      chunks.push({
        id: `${fileName}#${sectionIndex}-${pieceIndex}`,
        title: section.title,
        file: fileName,
        text,
        // 把「文件名 + 标题路径」拼进用于向量化的文本，
        // 这样用户问「标准版多少钱」时，标题里的「标准版」三个字也能参与匹配。
        fullText: `${fileTitle} ${section.title}\n${text}`,
      });
    });
  });

  return chunks;
}

/** 模块级缓存，避免每次请求都重新读盘切片 */
let cache: { signature: string; chunks: KnowledgeChunk[] } | null = null;

/**
 * 加载全部知识切片（带缓存）。
 * 每次调用都会比对知识库指纹，文件改了会自动重建，改完 md 不需要重启服务。
 */
export function loadChunks(): KnowledgeChunk[] {
  const signature = getKnowledgeSignature();

  if (cache && cache.signature === signature) {
    return cache.chunks;
  }

  const chunks = collectFiles(knowledgeRoot())
    .sort()
    .flatMap((file) => chunkFile(file));

  cache = { signature, chunks };
  return chunks;
}

/** 供调试用：清空缓存 */
export function clearKnowledgeCache(): void {
  cache = null;
}

/**
 * Embedding 后端。
 *
 * 提供两种实现，接口完全一致，通过 EMBEDDING_PROVIDER 环境变量切换：
 *   - local  零依赖的本地哈希 TF-IDF 向量（默认）。中文按「单字 + 相邻双字」切词，
 *            英文按整词切词，用特征哈希压到固定维度，再做 L2 归一化。
 *            不需要任何 API Key，离线可用，中英文都能检索。
 *   - openai 调用 OpenAI 兼容的 /v1/embeddings 接口，语义召回效果更好，但需要 Key。
 *
 * 两者的相似度都用余弦相似度计算，所以上层的检索逻辑完全不用区分。
 */

import { getEmbeddingConfig } from './config';

/** 本地向量的维度。取 2048 是为了让中文双字词的特征哈希碰撞足够少 */
const LOCAL_DIM = 2048;

/** 远程 embedding 单次请求的最大条数 */
const REMOTE_BATCH_SIZE = 64;

/** 远程请求超时（毫秒） */
const REMOTE_TIMEOUT_MS = 20_000;

/** 统一的 embedding 后端接口 */
export interface EmbeddingBackend {
  /** 后端标识，用于日志与 health 展示 */
  readonly name: string;
  /**
   * 用整个语料库做一次统计（本地 TF-IDF 需要算 IDF；远程 embedding 直接忽略）。
   * 必须在 embedBatch 之前调用一次。
   */
  fit(corpus: string[]): Promise<void>;
  /** 批量把文本转成向量 */
  embedBatch(texts: string[]): Promise<number[][]>;
}

/**
 * 分词：
 *   - 连续的汉字切成「单字」和「相邻双字」两种 token（双字携带语义，单字兜底短查询）
 *   - 连续的英文字母/数字作为整词
 *   - 命中同义词组时，把同组词一并展开（见 SYNONYM_GROUPS）
 * 例："退货政策 refund" → 退, 退货, 货, 货政, 政, 政策, 策, refund
 */
export function tokenize(text: string): string[] {
  const segments = text.toLowerCase().match(/[一-鿿]+|[a-z0-9]+/g) ?? [];
  const tokens: string[] = [];

  for (const segment of segments) {
    if (/^[a-z0-9]+$/.test(segment)) {
      tokens.push(segment);
      continue;
    }
    for (let i = 0; i < segment.length; i += 1) {
      tokens.push(segment[i]);
      if (i + 1 < segment.length) tokens.push(segment.slice(i, i + 2));
    }
  }

  // 同义词扩展：文档和查询走的是同一个函数，所以两边会被"拉齐"到同一套词上。
  // 例如用户问「多少钱」、文档里写「价格」，展开后双方都会带上对方的词。
  for (const word of expandSynonyms(text)) {
    for (let i = 0; i < word.length; i += 1) {
      tokens.push(word[i]);
      if (i + 1 < word.length) tokens.push(word.slice(i, i + 2));
    }
  }

  return tokens;
}

/**
 * 客服领域同义词组。
 *
 * 纯字面匹配的最大短板是「用户的口语」和「文档的书面语」对不上：
 * 用户问「多少钱」，文档里写的是「价格」，两者一个共同字都没有。
 * 这里把常见口语说法归到一组，任一词出现就把整组词都加进向量。
 *
 * 注意：只收「意图明确」的词，不要把「多少」「怎么样」这类泛疑问词收进来，
 * 否则无关问题也会被拉高分数，反而让阈值失效。
 */
const SYNONYM_GROUPS: string[][] = [
  ['价格', '多少钱', '费用', '收费', '价钱', '报价', '售价', '贵不贵'],
  ['退货', '退款', '退钱', '退换', '换货'],
  ['保修', '质保', '维修', '售后', '坏了', '故障'],
  ['发票', '开票', '报销凭证'],
  ['发货', '物流', '快递', '配送', '到货'],
  ['多久', '多长时间', '几天', '期限', '有效期'],
  ['转人工', '人工客服', '真人客服', '人工服务'],
  ['套餐', '版本', '档位'],
  ['渠道', '接入', '对接', '集成'],
  ['限制', '额度', '上限', '条数', '配额'],
];

/** 找出文本命中的同义词组，返回需要额外加入的词 */
function expandSynonyms(text: string): string[] {
  const lower = text.toLowerCase();
  const extra: string[] = [];

  for (const group of SYNONYM_GROUPS) {
    if (group.some((word) => lower.includes(word))) {
      extra.push(...group);
    }
  }

  return extra;
}

/**
 * 特征哈希（FNV-1a 32 位）。
 * 用一个哈希取模得到维度下标，再用另一个 bit 决定符号，
 * 这样即使两个词撞到同一维，也有一半概率互相抵消而不是互相叠加，减少伪相似。
 */
function hashFeature(token: string): { index: number; sign: number } {
  let hash = 0x811c9dc5;
  for (let i = 0; i < token.length; i += 1) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // 低 11 位做下标（2048 维），第 16 位做符号
  return { index: hash % LOCAL_DIM, sign: (hash >>> 16) & 1 ? -1 : 1 };
}

/** 本地哈希 TF-IDF embedding（导出的目的是给检索层做降级兜底） */
export class LocalTfIdfEmbedding implements EmbeddingBackend {
  readonly name = 'local:hash-tfidf';

  /** 特征下标 → IDF 权重 */
  private idf = new Map<number, number>();

  /**
   * 统计语料库的文档频率，换算成 IDF。
   * 公式沿用平滑版：idf = ln((N + 1) / (df + 1)) + 1
   */
  async fit(corpus: string[]): Promise<void> {
    const docCount = corpus.length;
    const df = new Map<number, number>();

    for (const doc of corpus) {
      const seen = new Set<number>();
      for (const token of tokenize(doc)) {
        const { index } = hashFeature(token);
        if (!seen.has(index)) {
          seen.add(index);
          df.set(index, (df.get(index) ?? 0) + 1);
        }
      }
    }

    this.idf = new Map();
    for (const [index, count] of df) {
      this.idf.set(index, Math.log((docCount + 1) / (count + 1)) + 1);
    }
  }

  /** 单条文本 → L2 归一化后的稀疏稠密向量 */
  private vectorize(text: string): number[] {
    const termFrequency = new Map<number, number>();
    const signs = new Map<number, number>();

    for (const token of tokenize(text)) {
      const { index, sign } = hashFeature(token);
      termFrequency.set(index, (termFrequency.get(index) ?? 0) + 1);
      signs.set(index, sign);
    }

    const vector = new Array<number>(LOCAL_DIM).fill(0);
    for (const [index, count] of termFrequency) {
      // 次线性 TF：1 + ln(tf)，避免长文本靠词频堆分
      const weight = (1 + Math.log(count)) * (this.idf.get(index) ?? 1);
      vector[index] += weight * (signs.get(index) ?? 1);
    }

    let norm = 0;
    for (const value of vector) norm += value * value;
    norm = Math.sqrt(norm);
    if (norm > 0) {
      for (let i = 0; i < LOCAL_DIM; i += 1) vector[i] /= norm;
    }

    return vector;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vectorize(text));
  }
}

/** OpenAI 兼容接口的远程 embedding */
class RemoteEmbedding implements EmbeddingBackend {
  readonly name: string;

  constructor(
    private readonly config: { apiKey: string; baseUrl: string; model: string },
  ) {
    this.name = `remote:${config.model}`;
  }

  async fit(): Promise<void> {
    // 远程 embedding 是无状态的，不需要语料统计
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const vectors: number[][] = [];

    for (let i = 0; i < texts.length; i += REMOTE_BATCH_SIZE) {
      const batch = texts.slice(i, i + REMOTE_BATCH_SIZE);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);

      try {
        const response = await fetch(`${this.config.baseUrl}/embeddings`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({ model: this.config.model, input: batch }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const detail = await response.text().catch(() => '');
          throw new Error(`Embedding 接口返回 ${response.status}：${detail.slice(0, 200)}`);
        }

        const json = (await response.json()) as {
          data: Array<{ embedding: number[]; index: number }>;
        };

        // 按 index 排序，保证返回顺序与入参一致
        const sorted = [...json.data].sort((a, b) => a.index - b.index);
        vectors.push(...sorted.map((item) => item.embedding));
      } finally {
        clearTimeout(timer);
      }
    }

    return vectors;
  }
}

/**
 * 根据环境变量创建 embedding 后端。
 * 配置了 openai 但没填 Key 时，自动降级为本地实现，保证服务永远可用。
 */
export function createEmbeddingBackend(): EmbeddingBackend {
  const config = getEmbeddingConfig();

  if (config.provider === 'openai' && config.apiKey) {
    return new RemoteEmbedding(config);
  }

  return new LocalTfIdfEmbedding();
}

/** 显式创建本地 embedding，用于远程接口失败时的降级 */
export function createLocalEmbeddingBackend(): EmbeddingBackend {
  return new LocalTfIdfEmbedding();
}

/** 余弦相似度。两端向量长度不一致时返回 0，避免脏数据算出离谱的分数 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;

  let dot = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

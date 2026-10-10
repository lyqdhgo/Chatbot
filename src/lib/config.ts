/**
 * 全部运行时配置的唯一出口。
 * 这里【只能】在服务端引入（API 路由 / 服务端模块），
 * 因为 process.env 中的 API Key 绝不能流到浏览器。
 */

/** 支持的模型厂商 */
export type ProviderName = 'deepseek' | 'openai' | 'qwen' | 'mock';

/** 大模型连接配置 */
export interface ModelConfig {
  provider: ProviderName;
  apiKey: string;
  baseUrl: string;
  model: string;
  /** 是否处于 mock 模式（不发真实请求，返回内置假回复） */
  isMock: boolean;
}

/** 读取整数型环境变量，非法时回退到默认值 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** 读取浮点型环境变量，非法时回退到默认值 */
function envFloat(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** 去掉首尾空白和结尾的斜杠，统一 base URL 形态 */
function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, '');
}

/**
 * 解析当前生效的模型配置。
 * 通过 MODEL_PROVIDER 环境变量切换厂商，各厂商的 Key/地址/模型名互不干扰，
 * 这样新增厂商只需要在这里加一个分支，调用方（lib/llm.ts）完全不用改。
 */
export function getModelConfig(): ModelConfig {
  const provider = (process.env.MODEL_PROVIDER || 'deepseek').trim().toLowerCase() as ProviderName;

  switch (provider) {
    case 'mock':
      return { provider: 'mock', apiKey: '', baseUrl: '', model: 'mock-model', isMock: true };

    case 'openai':
      return {
        provider: 'openai',
        apiKey: (process.env.OPENAI_API_KEY || '').trim(),
        baseUrl: normalizeBaseUrl(process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'),
        model: (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim(),
        isMock: false,
      };

    case 'qwen':
      return {
        provider: 'qwen',
        apiKey: (process.env.DASHSCOPE_API_KEY || '').trim(),
        baseUrl: normalizeBaseUrl(
          process.env.DASHSCOPE_BASE_URL || 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        ),
        model: (process.env.DASHSCOPE_MODEL || 'qwen-plus').trim(),
        isMock: false,
      };

    case 'deepseek':
    default:
      return {
        provider: 'deepseek',
        apiKey: (process.env.DEEPSEEK_API_KEY || '').trim(),
        baseUrl: normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1'),
        model: (process.env.DEEPSEEK_MODEL || 'deepseek-chat').trim(),
        isMock: false,
      };
  }
}

/** 对话上下文配置 */
export function getContextConfig() {
  return {
    /** 服务端保留最近多少轮对话（1 轮 = 一问一答） */
    maxRounds: envInt('MAX_CONTEXT_ROUNDS', 10),
    /** 单条用户消息字符上限 */
    maxUserMessageChars: envInt('MAX_USER_MESSAGE_CHARS', 1000),
  };
}

/** RAG 检索配置 */
export function getRagConfig() {
  return {
    /** 召回片段数 */
    topK: envInt('RAG_TOP_K', 3),
    /** 余弦相似度阈值，低于该值视为未命中。0.15 是实测校准值：自带知识库上
     *  真实问题落在 0.164~0.420，无关问题落在 0.043~0.116，取两者之间。 */
    scoreThreshold: envFloat('RAG_SCORE_THRESHOLD', 0.15),
    /** 切片大小（字符） */
    chunkSize: envInt('CHUNK_SIZE', 300),
    /** 切片重叠（字符） */
    chunkOverlap: envInt('CHUNK_OVERLAP', 50),
  };
}

/** Embedding 配置 */
export function getEmbeddingConfig() {
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').trim().toLowerCase();
  return {
    provider: provider === 'openai' ? ('openai' as const) : ('local' as const),
    apiKey: (process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || '').trim(),
    baseUrl: normalizeBaseUrl(process.env.EMBEDDING_BASE_URL || 'https://api.openai.com/v1'),
    model: (process.env.EMBEDDING_MODEL || 'text-embedding-3-small').trim(),
  };
}

/** 数据目录（相对项目根目录），可用环境变量覆盖，方便容器化挂载 */
export function getDataDir(): string {
  return (process.env.DATA_DIR || 'data').trim();
}

/** 知识库目录（相对项目根目录） */
export function getKnowledgeDir(): string {
  return (process.env.KNOWLEDGE_DIR || 'knowledge').trim();
}

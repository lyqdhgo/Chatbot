/**
 * 全局共享类型定义。
 * 这些类型同时被服务端（API 路由、RAG、会话存储）和前端组件引用，
 * 所以这里不能出现任何 fs / process.env 相关的代码，保证能被客户端打包。
 */

/** 对话角色 */
export type Role = 'system' | 'user' | 'assistant';

/** 命中知识库后返回给前端的引用片段 */
export interface RetrievedSource {
  /** 片段唯一 id，形如 "价格方案.md#3" */
  id: string;
  /** 标题路径，如 "价格方案 > 标准版" */
  title: string;
  /** 来源文件名，如 "价格方案.md" */
  file: string;
  /** 余弦相似度，0~1 */
  score: number;
  /** 片段文本预览（截断后的） */
  preview: string;
}

/** 转人工事件的载荷 */
export interface HandoffPayload {
  /** 触发原因：用户主动要求 / 知识库未命中 / 模型自判需要升级 */
  reason: 'user_request' | 'kb_miss';
  /** 触发时的原始问题 */
  question: string;
  /** 触发时间 ISO 字符串 */
  createdAt: string;
}

/** 一条聊天消息（前后端通用的存储结构） */
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** ISO 时间字符串 */
  createdAt: string;
  /** 助手消息专属：本次回答引用了哪些知识片段 */
  sources?: RetrievedSource[];
  /** 助手消息专属：本条回答是否触发了转人工 */
  handoff?: HandoffPayload | null;
  /** 用户对助手消息的反馈 */
  feedback?: 'up' | 'down' | null;
  /** 是否为敏感词拦截产生的回复 */
  blocked?: boolean;
}

/** 完整会话记录（落盘到 data/sessions/<id>.json） */
export interface SessionRecord {
  id: string;
  /** 会话标题，取首条用户消息前 20 字 */
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
}

/** 会话列表项（侧边栏用，不含完整消息体） */
export interface SessionSummary {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
  /** 最后一条消息的摘要，用于列表预览 */
  lastMessage: string;
}

/** 知识库切片 */
export interface KnowledgeChunk {
  id: string;
  /** 标题路径，如 "退换货政策 > 七天无理由退货" */
  title: string;
  /** 来源文件名 */
  file: string;
  text: string;
  /** 标题 + 正文拼在一起后的完整文本，用于向量化和展示 */
  fullText: string;
}

/** 前端 → 服务端：POST /api/chat 的请求体 */
export interface ChatRequestBody {
  sessionId: string;
  message: string;
}

/** 服务端 → 前端：SSE 流式事件 */
export type StreamEvent =
  | {
      type: 'meta';
      sessionId: string;
      /** 本轮命中的知识片段（未命中则为空数组） */
      sources: RetrievedSource[];
      /** 是否未命中知识库 */
      miss: boolean;
      /** 当前使用的模型厂商 */
      provider: string;
      /** 是否处于 mock（假回复）模式 */
      mock: boolean;
    }
  | { type: 'delta'; text: string }
  | { type: 'handoff'; payload: HandoffPayload }
  | { type: 'done'; messageId: string }
  | { type: 'error'; message: string };

/** 健康检查 / 全局状态接口的返回体 */
export interface HealthInfo {
  ok: boolean;
  provider: string;
  model: string;
  mock: boolean;
  /** 是否已配置可用的 API Key */
  keyConfigured: boolean;
  embeddingProvider: string;
  knowledge: {
    files: number;
    chunks: number;
    enabled: boolean;
  };
}

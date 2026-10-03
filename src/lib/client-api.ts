/**
 * 浏览器端调用后端接口的封装。
 * 只依赖 fetch，不引入任何请求库；所有错误统一转成中文提示。
 *
 * 注意：这里绝不接触任何 API Key，模型调用全部发生在服务端。
 */

import type {
  ChatMessage,
  HealthInfo,
  SessionRecord,
  SessionSummary,
  StreamEvent,
} from './types';

/** 统一的请求错误，message 是可以直接展示给用户的中文文案 */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** 从响应里提取后端的错误文案 */
async function extractError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { error?: string };
    if (data?.error) return data.error;
  } catch {
    /* 响应不是 JSON，走下面的兜底文案 */
  }
  return `请求失败（HTTP ${response.status}）`;
}

/** 拉取服务状态 */
export async function fetchHealth(): Promise<HealthInfo> {
  const response = await fetch('/api/health', { cache: 'no-store' });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
  return (await response.json()) as HealthInfo;
}

/** 拉取历史会话列表 */
export async function fetchSessions(): Promise<SessionSummary[]> {
  const response = await fetch('/api/sessions', { cache: 'no-store' });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
  const data = (await response.json()) as { sessions: SessionSummary[] };
  return data.sessions;
}

/** 新建一个会话 */
export async function createSession(): Promise<SessionRecord> {
  const response = await fetch('/api/sessions', { method: 'POST' });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
  const data = (await response.json()) as { session: SessionRecord };
  return data.session;
}

/** 读取某个会话的完整内容 */
export async function fetchSession(id: string): Promise<SessionRecord> {
  const response = await fetch(`/api/sessions/${id}`, { cache: 'no-store' });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
  const data = (await response.json()) as { session: SessionRecord };
  return data.session;
}

/** 清空某个会话的消息 */
export async function clearSession(id: string): Promise<SessionRecord> {
  const response = await fetch(`/api/sessions/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'clear' }),
  });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
  const data = (await response.json()) as { session: SessionRecord };
  return data.session;
}

/** 删除某个会话 */
export async function deleteSession(id: string): Promise<void> {
  const response = await fetch(`/api/sessions/${id}`, { method: 'DELETE' });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
}

/** 提交 👍 / 👎 反馈 */
export async function submitFeedback(
  sessionId: string,
  messageId: string,
  rating: 'up' | 'down',
): Promise<void> {
  const response = await fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, messageId, rating }),
  });
  if (!response.ok) throw new ApiError(await extractError(response), response.status);
}

export interface StreamChatHandlers {
  onMeta?: (event: Extract<StreamEvent, { type: 'meta' }>) => void;
  onDelta?: (text: string) => void;
  onHandoff?: (event: Extract<StreamEvent, { type: 'handoff' }>) => void;
  onDone?: (messageId: string) => void;
}

/**
 * 发起一次流式对话。
 *
 * 服务端返回的是 SSE 文本流，但因为是 POST 请求，不能直接用 EventSource，
 * 所以这里手动读取 ReadableStream 并按 `\n\n` 切分事件块。
 */
export async function streamChat(
  sessionId: string,
  message: string,
  handlers: StreamChatHandlers,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
    signal,
  });

  if (!response.ok) {
    throw new ApiError(await extractError(response), response.status);
  }
  if (!response.body) {
    throw new ApiError('当前浏览器不支持流式响应，请更换 Chrome / Edge / Safari 最新版。');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    // 最后一块可能不完整，留到下一轮
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      // 一个事件块形如：
      //   event: delta
      //   data: {"type":"delta","text":"你"}
      const dataLine = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');

      if (!dataLine) continue;

      let event: StreamEvent;
      try {
        event = JSON.parse(dataLine) as StreamEvent;
      } catch {
        continue; // 忽略解析不了的心跳行
      }

      switch (event.type) {
        case 'meta':
          handlers.onMeta?.(event);
          break;
        case 'delta':
          handlers.onDelta?.(event.text);
          break;
        case 'handoff':
          handlers.onHandoff?.(event);
          break;
        case 'done':
          handlers.onDone?.(event.messageId);
          break;
        case 'error':
          throw new ApiError(event.message);
      }
    }
  }
}

/** 把服务端返回的消息转成前端 UI 用的消息 */
export type UiMessage = ChatMessage & {
  /** 是否正在流式输出中（用于显示光标和禁用反馈按钮） */
  streaming?: boolean;
};

/** 服务端消息 → UI 消息 */
export function toUiMessages(messages: ChatMessage[]): UiMessage[] {
  return messages.map((message) => ({ ...message, streaming: false }));
}

/**
 * 大模型调用层。
 *
 * 所有厂商都走 OpenAI 兼容的 /chat/completions 接口（DeepSeek、通义千问、
 * 各类中转网关都支持这套协议），所以这里只需要维护一份实现，
 * 差异全部由 lib/config.ts 里的 baseUrl / model / apiKey 决定。
 *
 * 本文件【只能在服务端引入】，API Key 从进程环境变量读取，永远不会下发给浏览器。
 */

import { getModelConfig, type ModelConfig } from './config';
import type { ContextMessage } from './context';
import type { RiskyDomain } from './moderation';
import { COMPLIANCE_FALLBACK } from './prompt';

/** 本轮对话的附加信息，mock 模式据此生成合理假回复；真实模式不参与请求 */
export interface ChatTurnContext {
  /** 知识库是否未命中 */
  miss: boolean;
  /** 知识库是否为空 */
  emptyKb: boolean;
  /** 命中的知识片段正文，按相关度降序 */
  matchedTexts: string[];
  /** 医疗 / 法律 / 投资类风险领域 */
  riskyDomain: RiskyDomain | null;
  /** 是否只是寒暄 */
  isSmallTalk: boolean;
}

export interface StreamChatOptions {
  systemPrompt: string;
  /** 已裁剪好的历史消息（最后一条是本轮用户提问） */
  messages: ContextMessage[];
  turn: ChatTurnContext;
  /** 客户端断开时用它中断上游请求，避免继续烧 token */
  signal?: AbortSignal;
  /** 每收到一段增量文本就回调一次 */
  onDelta: (chunk: string) => void;
}

export interface StreamChatResult {
  text: string;
  model: string;
  mock: boolean;
}

/** 带用户可读文案的模型调用异常 */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** 客服场景要的是稳定而不是创意，温度调低能明显减少编造 */
const TEMPERATURE = 0.3;
/** 回答长度上限，配合 system prompt 里「3 句以内」的要求 */
const MAX_TOKENS = 600;

/**
 * 流式对话主入口。
 * 调用方只需要关心 onDelta 回调和最终结果，不用管底层是哪家厂商。
 */
export async function streamChat(options: StreamChatOptions): Promise<StreamChatResult> {
  const config = getModelConfig();

  if (config.isMock) {
    return mockStream(options);
  }

  if (!config.apiKey) {
    throw new LlmError(
      `未配置 ${config.provider} 的 API Key。请在项目根目录的 .env.local 中填写后重启服务，` +
        `或把 MODEL_PROVIDER 改成 mock 以无 Key 体验完整流程。`,
    );
  }

  return remoteStream(config, options);
}

// ---------------------------------------------------------------------------
// 真实厂商调用
// ---------------------------------------------------------------------------

/** 把 HTTP 状态码翻译成用户看得懂的中文提示 */
function describeHttpError(status: number, body: string, provider: string): string {
  switch (status) {
    case 401:
      return `${provider} 的 API Key 无效或已过期，请检查 .env.local 中的配置。`;
    case 402:
      return `${provider} 账户余额不足，请充值后重试。`;
    case 403:
      return `${provider} 拒绝了本次请求，请确认账号已开通该模型的权限。`;
    case 404:
      return `找不到模型接口，请检查 ${provider} 的 BASE_URL 与模型名是否正确。`;
    case 429:
      return `请求过于频繁，已触发 ${provider} 的限流，请稍后重试。`;
    default:
      if (status >= 500) return `${provider} 服务暂时不可用（${status}），请稍后重试。`;
      return `${provider} 返回错误（${status}）：${body.slice(0, 200)}`;
  }
}

/** 真正发起流式请求并逐段回调 */
async function remoteStream(
  config: ModelConfig,
  options: StreamChatOptions,
): Promise<StreamChatResult> {
  const { systemPrompt, messages, signal, onDelta } = options;

  const payload = {
    model: config.model,
    stream: true,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    messages: [{ role: 'system', content: systemPrompt }, ...messages],
  };

  let response: Response;
  try {
    response = await fetch(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new LlmError(`无法连接 ${config.provider}（${config.baseUrl}），请检查本机网络或代理设置。`);
  }

  if (!response.ok || !response.body) {
    const body = await response.text().catch(() => '');
    throw new LlmError(
      describeHttpError(response.status, body, config.provider),
      response.status,
    );
  }

  // 逐行解析 SSE：每行形如 `data: {...}`，以 `data: [DONE]` 结束
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    // 最后一段可能是不完整的行，留到下一轮再拼
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data:')) continue;

      const data = trimmed.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const parsed = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
          error?: { message?: string };
        };

        if (parsed.error?.message) {
          throw new LlmError(`${config.provider} 返回错误：${parsed.error.message}`);
        }

        const delta = parsed.choices?.[0]?.delta?.content;
        if (delta) {
          text += delta;
          onDelta(delta);
        }
      } catch (error) {
        if (error instanceof LlmError) throw error;
        // 心跳包或非标准行，跳过即可
      }
    }
  }

  if (!text.trim()) {
    throw new LlmError('模型没有返回任何内容，请稍后重试。');
  }

  return { text, model: config.model, mock: false };
}

// ---------------------------------------------------------------------------
// Mock 模式：不需要任何 API Key，用来演示和自测完整链路
// ---------------------------------------------------------------------------

/** 按小块吐字，模拟真实的打字机节奏 */
async function streamText(
  text: string,
  onDelta: (chunk: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const STEP = 3;
  for (let i = 0; i < text.length; i += STEP) {
    if (signal?.aborted) return;
    const chunk = text.slice(i, i + STEP);
    onDelta(chunk);
    await new Promise((resolve) => setTimeout(resolve, 16));
  }
}

/** 把知识片段压缩成适合当回复的长度 */
function condense(text: string, max: number): string {
  const lines = text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 6);
  const joined = lines.join('\n');
  return joined.length > max ? `${joined.slice(0, max)}…` : joined;
}

/**
 * 生成 mock 回复。
 * 分支顺序与真实链路完全一致：风险领域 → 寒暄 → 未命中 → 命中，
 * 所以用它自测出来的流程和接真实模型时是同一条代码路径。
 */
function buildMockReply(turn: ChatTurnContext, messages: ContextMessage[]): string {
  const question = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';

  if (turn.riskyDomain) {
    return COMPLIANCE_FALLBACK;
  }

  if (turn.isSmallTalk) {
    return '您好，我是云雀 AI 助理的在线客服，很高兴为您服务。您可以问我产品功能、价格方案或售后政策方面的问题。';
  }

  if (turn.miss || turn.emptyKb) {
    const short = question.length > 20 ? `${question.slice(0, 20)}…` : question;
    return `这点我确认一下，我先帮您核实「${short}」的具体情况。\n\n您也可以转接人工客服，由同事为您进一步确认。`;
  }

  return `根据我们的资料，为您解答如下：\n\n${condense(turn.matchedTexts[0] ?? '', 240)}\n\n如果还需要补充说明，我可以帮您转接人工客服。`;
}

/** mock 模式的流式实现 */
async function mockStream(options: StreamChatOptions): Promise<StreamChatResult> {
  const reply = buildMockReply(options.turn, options.messages);
  await streamText(reply, options.onDelta, options.signal);
  return { text: reply, model: 'mock-model', mock: true };
}

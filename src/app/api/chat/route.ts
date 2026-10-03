/**
 * POST /api/chat —— 客服对话主接口（SSE 流式）。
 *
 * 一次请求的完整流程：
 *   1. 校验入参、敏感词过滤
 *   2. 落盘用户消息（重试时幂等，不会重复写入）
 *   3. 转人工意图 → 直接返回固定话术 + 结构化转人工事件（不消耗模型额度）
 *   4. RAG 检索 → 命中则把片段注入 system prompt；未命中则记入 unanswered.jsonl
 *   5. 流式调用大模型，逐段通过 SSE 推给前端
 *   6. 落盘助手回复，并在需要时补发转人工事件
 *
 * 所有模型调用都在这里（服务端）完成，API Key 不会出现在任何响应里。
 */

import { randomUUID } from 'node:crypto';
import { getContextConfig, getModelConfig } from '@/lib/config';
import { selectContextMessages } from '@/lib/context';
import { recordUnanswered } from '@/lib/analytics';
import { streamChat, LlmError } from '@/lib/llm';
import {
  checkSensitive,
  detectHandoffIntent,
  detectRiskyDomain,
  isSmallTalk,
} from '@/lib/moderation';
import { buildSystemPrompt, HANDOFF_PREFIX, SENSITIVE_REPLY } from '@/lib/prompt';
import { formatKnowledgeBlock, retrieve } from '@/lib/retriever';
import { appendMessage, getSession, isValidSessionId } from '@/lib/sessions';
import type { ChatMessage, HandoffPayload, StreamEvent } from '@/lib/types';

// 必须跑在 Node.js 运行时：要用 fs 读写知识库与会话文件
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** 返回一个非流式的 JSON 错误（用于参数校验阶段） */
function badRequest(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(request: Request): Promise<Response> {
  const contextConfig = getContextConfig();
  const modelConfig = getModelConfig();

  // ---------- 1. 参数校验 ----------
  let body: { sessionId?: unknown; message?: unknown };
  try {
    body = await request.json();
  } catch {
    return badRequest('请求格式不正确，应为 JSON。');
  }

  const sessionId = body.sessionId;
  const rawMessage = typeof body.message === 'string' ? body.message : '';
  const message = rawMessage.trim();

  if (!isValidSessionId(sessionId)) {
    return badRequest('会话 ID 不合法，请刷新页面后重试。');
  }
  if (!message) {
    return badRequest('消息内容不能为空。');
  }
  if (message.length > contextConfig.maxUserMessageChars) {
    return badRequest(
      `消息太长了（${message.length} 字），请控制在 ${contextConfig.maxUserMessageChars} 字以内。`,
    );
  }

  // ---------- 2. 前置判定 ----------
  const sensitive = checkSensitive(message);
  const wantsHuman = detectHandoffIntent(message);
  const smallTalk = isSmallTalk(message);
  const riskyDomain = sensitive.blocked ? null : detectRiskyDomain(message);

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;

      /** 推送一个 SSE 事件；客户端已断开时静默忽略 */
      const send = (event: StreamEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          closed = true;
        }
      };

      const finish = () => {
        if (closed) return;
        closed = true;
        try {
          controller.close();
        } catch {
          /* 已经关闭 */
        }
      };

      const now = () => new Date().toISOString();

      try {
        // ---------- 3. 落盘用户消息（幂等：失败重试时不会重复写入）----------
        const session = await appendUserMessageOnce(sessionId, message, now());

        // ---------- 4. 分支 A：敏感词拦截，不调用模型 ----------
        if (sensitive.blocked) {
          console.warn(`[chat] 敏感词命中：${sensitive.hits.join(', ')}`);
          send({
            type: 'meta',
            sessionId,
            sources: [],
            miss: false,
            provider: modelConfig.provider,
            mock: modelConfig.isMock,
          });
          send({ type: 'delta', text: SENSITIVE_REPLY });
          const assistant = await saveAssistant(sessionId, {
            content: SENSITIVE_REPLY,
            blocked: true,
          });
          send({ type: 'done', messageId: assistant.id });
          return finish();
        }

        // ---------- 5. 分支 B：用户明确要求转人工，不调用模型 ----------
        if (wantsHuman) {
          const handoff: HandoffPayload = {
            reason: 'user_request',
            question: message,
            createdAt: now(),
          };
          send({
            type: 'meta',
            sessionId,
            sources: [],
            miss: false,
            provider: modelConfig.provider,
            mock: modelConfig.isMock,
          });
          send({ type: 'delta', text: HANDOFF_PREFIX });
          const assistant = await saveAssistant(sessionId, {
            content: HANDOFF_PREFIX,
            handoff,
          });
          send({ type: 'handoff', payload: handoff });
          send({ type: 'done', messageId: assistant.id });
          return finish();
        }

        // ---------- 6. RAG 检索 ----------
        const retrieval = await retrieve(message);
        const useKnowledge = !smallTalk && !retrieval.miss;
        // topScore 为 0 说明知识库压根没有可用切片（目录为空或全是空文件）
        const emptyKb = retrieval.topScore === 0;

        // 未命中且不是寒暄 → 记入未答问题，方便后续补 FAQ
        if (!smallTalk && retrieval.miss) {
          await recordUnanswered({
            question: message,
            sessionId,
            topScore: retrieval.topScore,
            reason: emptyKb ? 'kb_empty' : 'kb_miss',
            createdAt: now(),
          });
        }

        const systemPrompt = buildSystemPrompt({
          sources: useKnowledge ? retrieval.sources : [],
          knowledgeBlock: useKnowledge ? formatKnowledgeBlock(retrieval.matches) : '',
          riskyDomain: riskyDomain !== null,
          isSmallTalk: smallTalk,
        });

        // 注意：session.messages 里已经包含本轮的用户提问（上面刚落盘），
        // 所以这里不要再额外追加，否则最新一问会被重复发给模型。
        const history = selectContextMessages(session.messages, contextConfig.maxRounds);

        send({
          type: 'meta',
          sessionId,
          sources: useKnowledge ? retrieval.sources : [],
          miss: !smallTalk && retrieval.miss,
          provider: modelConfig.provider,
          mock: modelConfig.isMock,
        });

        // ---------- 7. 流式调用模型 ----------
        let answer = '';
        let aborted = false;

        try {
          const result = await streamChat({
            systemPrompt,
            messages: history,
            turn: {
              miss: retrieval.miss,
              emptyKb,
              matchedTexts: retrieval.matches.map((m) => m.chunk.text),
              riskyDomain,
              isSmallTalk: smallTalk,
            },
            signal: request.signal,
            onDelta: (chunk) => {
              answer += chunk;
              send({ type: 'delta', text: chunk });
            },
          });
          answer = result.text;
        } catch (error) {
          // 客户端主动断开：把已经生成的部分存下来，不再报错
          if ((error as Error).name === 'AbortError') {
            aborted = true;
          } else {
            throw error;
          }
        }

        // ---------- 8. 落盘助手回复 ----------
        const needHandoff = !smallTalk && retrieval.miss;
        const handoff: HandoffPayload | null = needHandoff
          ? { reason: 'kb_miss', question: message, createdAt: now() }
          : null;

        if (answer.trim()) {
          const assistant = await saveAssistant(sessionId, {
            content: answer,
            sources: useKnowledge ? retrieval.sources : [],
            handoff,
          });

          // 知识库未命中 → 补发转人工事件，前端据此弹出转人工卡片
          if (handoff) {
            send({ type: 'handoff', payload: handoff });
          }
          send({ type: 'done', messageId: assistant.id });
        } else if (!aborted) {
          send({ type: 'error', message: '模型没有返回任何内容，请重试。' });
        }

        finish();
      } catch (error) {
        const message =
          error instanceof LlmError
            ? error.message
            : '服务出了点小问题，请稍后重试。';
        if (!(error instanceof LlmError)) {
          console.error('[chat] 未预期的错误：', error);
        }
        send({ type: 'error', message });
        finish();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // 关掉 Nginx 等反向代理的缓冲，否则流式会被攒成一坨再吐出来
      'X-Accel-Buffering': 'no',
    },
  });
}

// ---------------------------------------------------------------------------
// 辅助函数
// ---------------------------------------------------------------------------

/**
 * 写入用户消息。
 * 如果会话最后一条已经是内容完全相同的用户消息（说明上次请求失败了，前端点了重试），
 * 就不再重复写入，保证重试幂等。
 */
async function appendUserMessageOnce(
  sessionId: string,
  content: string,
  createdAt: string,
): Promise<Awaited<ReturnType<typeof appendMessage>>> {
  const existing = await getSession(sessionId);
  const last = existing?.messages[existing.messages.length - 1];

  if (existing && last && last.role === 'user' && last.content === content) {
    return existing;
  }

  return appendMessage(sessionId, {
    id: randomUUID(),
    role: 'user',
    content,
    createdAt,
  });
}

/** 写入助手消息，返回落盘后的完整对象 */
async function saveAssistant(
  sessionId: string,
  patch: Pick<ChatMessage, 'content'> & Partial<ChatMessage>,
): Promise<ChatMessage> {
  const assistant: ChatMessage = {
    id: randomUUID(),
    role: 'assistant',
    createdAt: new Date().toISOString(),
    ...patch,
  };
  await appendMessage(sessionId, assistant);
  return assistant;
}

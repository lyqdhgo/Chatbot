/**
 * POST /api/feedback —— 记录用户对某条回答的 👍 / 👎。
 * 反馈会追加写入 data/feedback.jsonl，并回填到会话文件里，刷新后仍然可见。
 */

import { recordFeedback } from '@/lib/analytics';
import { getSession, isValidSessionId, updateMessage } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request): Promise<Response> {
  let body: { sessionId?: unknown; messageId?: unknown; rating?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: '请求格式不正确，应为 JSON。' }, { status: 400 });
  }

  const { sessionId, messageId, rating } = body;

  if (!isValidSessionId(sessionId)) {
    return Response.json({ error: '会话 ID 不合法。' }, { status: 400 });
  }
  if (typeof messageId !== 'string' || !messageId) {
    return Response.json({ error: '缺少消息 ID。' }, { status: 400 });
  }
  if (rating !== 'up' && rating !== 'down') {
    return Response.json({ error: '反馈类型只能是 up 或 down。' }, { status: 400 });
  }

  try {
    const session = await getSession(sessionId);
    if (!session) {
      return Response.json({ error: '会话不存在。' }, { status: 404 });
    }

    const index = session.messages.findIndex((m) => m.id === messageId);
    if (index < 0) {
      return Response.json({ error: '找不到对应消息。' }, { status: 404 });
    }

    // 往前找最近的一条用户提问，一并记下来，方便分析「哪类问题答得不好」
    let question = '';
    for (let i = index - 1; i >= 0; i -= 1) {
      if (session.messages[i].role === 'user') {
        question = session.messages[i].content;
        break;
      }
    }

    await recordFeedback({
      sessionId,
      messageId,
      rating,
      question,
      answer: session.messages[index].content,
      createdAt: new Date().toISOString(),
    });

    await updateMessage(sessionId, messageId, { feedback: rating });

    return Response.json({ ok: true });
  } catch (error) {
    console.error('[feedback] 记录反馈失败：', error);
    return Response.json({ error: '记录反馈失败，请稍后重试。' }, { status: 500 });
  }
}

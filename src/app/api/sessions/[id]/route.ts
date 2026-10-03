/**
 * GET    /api/sessions/:id          读取会话完整内容
 * PATCH  /api/sessions/:id          对会话执行动作（目前只有 clear＝清空消息）
 * DELETE /api/sessions/:id          删除整个会话
 */

import { clearSessionMessages, deleteSession, getSession, isValidSessionId } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Next 15 起 params 是 Promise，这里兼容两种写法 */
async function resolveId(context: { params: { id: string } | Promise<{ id: string }> }) {
  const params = await context.params;
  return params.id;
}

function invalidId(): Response {
  return Response.json({ error: '会话 ID 不合法。' }, { status: 400 });
}

export async function GET(
  _request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
): Promise<Response> {
  const id = await resolveId(context);
  if (!isValidSessionId(id)) return invalidId();

  try {
    const session = await getSession(id);
    if (!session) return Response.json({ error: '会话不存在。' }, { status: 404 });
    return Response.json({ session });
  } catch (error) {
    console.error('[sessions/:id] 读取会话失败：', error);
    return Response.json({ error: '读取会话失败，请稍后重试。' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
): Promise<Response> {
  const id = await resolveId(context);
  if (!isValidSessionId(id)) return invalidId();

  let action = '';
  try {
    const body = (await request.json()) as { action?: string };
    action = body.action ?? '';
  } catch {
    return Response.json({ error: '请求格式不正确，应为 JSON。' }, { status: 400 });
  }

  try {
    if (action === 'clear') {
      const session = await clearSessionMessages(id);
      return Response.json({ session });
    }
    return Response.json({ error: `不支持的操作：${action}` }, { status: 400 });
  } catch (error) {
    console.error('[sessions/:id] 操作失败：', error);
    return Response.json({ error: '操作失败，请稍后重试。' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  context: { params: { id: string } | Promise<{ id: string }> },
): Promise<Response> {
  const id = await resolveId(context);
  if (!isValidSessionId(id)) return invalidId();

  try {
    const deleted = await deleteSession(id);
    return Response.json({ deleted });
  } catch (error) {
    console.error('[sessions/:id] 删除会话失败：', error);
    return Response.json({ error: '删除会话失败，请稍后重试。' }, { status: 500 });
  }
}

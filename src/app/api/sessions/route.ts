/**
 * GET  /api/sessions  列出全部历史会话
 * POST /api/sessions  新建一个空会话
 */

import { createSessionId, getOrCreateSession, listSessions } from '@/lib/sessions';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  try {
    const sessions = await listSessions();
    return Response.json({ sessions });
  } catch (error) {
    console.error('[sessions] 读取会话列表失败：', error);
    return Response.json({ error: '读取历史会话失败，请稍后重试。' }, { status: 500 });
  }
}

export async function POST(): Promise<Response> {
  try {
    const id = createSessionId();
    const session = await getOrCreateSession(id);
    return Response.json({ session });
  } catch (error) {
    console.error('[sessions] 新建会话失败：', error);
    return Response.json({ error: '新建会话失败，请稍后重试。' }, { status: 500 });
  }
}

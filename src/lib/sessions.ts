/**
 * 会话持久化。
 *
 * 每个会话一个 JSON 文件：data/sessions/<sessionId>.json
 * 服务端保存完整的多轮历史，前端只用 localStorage 记住 sessionId，
 * 这样换浏览器/清缓存后历史仍然在，也避免把对话内容暴露在前端存储里。
 *
 * 同一会话的写操作会串行化（见 withSessionLock），
 * 防止「用户消息」和「助手回复」两次写入互相覆盖。
 */

import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { dataPath, ensureDir, readJsonOrNull, writeFileAtomic } from './store';
import type { ChatMessage, SessionRecord, SessionSummary } from './types';

/** 会话 ID 只允许这些字符，杜绝 ../ 之类的路径穿越攻击 */
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{6,64}$/;

/** 会话标题最大长度 */
const TITLE_MAX_LENGTH = 20;

/** 判断前端传来的 sessionId 是否合法 */
export function isValidSessionId(id: unknown): id is string {
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id);
}

/** 生成一个新的会话 ID */
export function createSessionId(): string {
  return randomUUID();
}

/** 会话文件路径 */
function sessionFile(id: string): string {
  if (!isValidSessionId(id)) {
    throw new Error(`非法的会话 ID：${id}`);
  }
  return dataPath('sessions', `${id}.json`);
}

/** 会话目录 */
function sessionsDir(): string {
  return dataPath('sessions');
}

// ---------------------------------------------------------------------------
// 写锁：保证同一会话的读改写序列不被打断
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();

/**
 * 在指定会话的独占锁内执行任务。
 * 任务抛错不会阻塞后续任务（用 task 同时作为成功和失败的回调）。
 */
export function withSessionLock<T>(id: string, task: () => Promise<T>): Promise<T> {
  const previous = locks.get(id) ?? Promise.resolve();
  const run = previous.then(task, task);

  const guard = run.then(
    () => undefined,
    () => undefined,
  );
  locks.set(id, guard);
  guard.then(() => {
    // 只有队尾还是自己时才清理，避免误删后来者的锁
    if (locks.get(id) === guard) locks.delete(id);
  });

  return run;
}

// ---------------------------------------------------------------------------
// 基础读写
// ---------------------------------------------------------------------------

/** 读取会话，不存在返回 null */
export async function getSession(id: string): Promise<SessionRecord | null> {
  if (!isValidSessionId(id)) return null;
  return readJsonOrNull<SessionRecord>(sessionFile(id));
}

/** 写入会话（原子写） */
export async function saveSession(record: SessionRecord): Promise<void> {
  await ensureDir(sessionsDir());
  await writeFileAtomic(sessionFile(record.id), JSON.stringify(record, null, 2));
}

/** 读取会话，不存在则新建一个空会话 */
export async function getOrCreateSession(id: string): Promise<SessionRecord> {
  const existing = await getSession(id);
  if (existing) return existing;

  const now = new Date().toISOString();
  const record: SessionRecord = {
    id,
    title: '新会话',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  await saveSession(record);
  return record;
}

/** 用首条用户消息生成会话标题 */
export function buildTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '新会话';
  return flat.length > TITLE_MAX_LENGTH ? `${flat.slice(0, TITLE_MAX_LENGTH)}…` : flat;
}

/** 追加一条消息（在写锁内完成读-改-写） */
export async function appendMessage(id: string, message: ChatMessage): Promise<SessionRecord> {
  return withSessionLock(id, async () => {
    const session = await getOrCreateSession(id);

    session.messages.push(message);
    session.updatedAt = message.createdAt;

    // 首条用户消息用来当标题
    if (message.role === 'user' && session.messages.filter((m) => m.role === 'user').length === 1) {
      session.title = buildTitle(message.content);
    }

    await saveSession(session);
    return session;
  });
}

/** 局部更新某条消息（用于回填 sources / handoff / feedback），找不到就原样返回 */
export async function updateMessage(
  id: string,
  messageId: string,
  patch: Partial<ChatMessage>,
): Promise<SessionRecord | null> {
  return withSessionLock(id, async () => {
    const session = await getSession(id);
    if (!session) return null;

    const target = session.messages.find((message) => message.id === messageId);
    if (!target) return session;

    Object.assign(target, patch);
    session.updatedAt = new Date().toISOString();
    await saveSession(session);
    return session;
  });
}

/** 清空当前会话的全部消息（保留会话本身，前端表现为「清空当前会话」） */
export async function clearSessionMessages(id: string): Promise<SessionRecord> {
  return withSessionLock(id, async () => {
    const session = await getOrCreateSession(id);
    session.messages = [];
    session.title = '新会话';
    session.updatedAt = new Date().toISOString();
    await saveSession(session);
    return session;
  });
}

/** 彻底删除会话文件 */
export async function deleteSession(id: string): Promise<boolean> {
  if (!isValidSessionId(id)) return false;
  try {
    await fs.unlink(sessionFile(id));
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

/** 列出全部会话（按更新时间倒序），只返回摘要信息 */
export async function listSessions(): Promise<SessionSummary[]> {
  const dir = sessionsDir();

  let files: string[];
  try {
    files = await fs.readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }

  const summaries: SessionSummary[] = [];

  for (const file of files) {
    if (!file.endsWith('.json')) continue;
    const id = path.basename(file, '.json');
    const session = await readJsonOrNull<SessionRecord>(path.join(dir, file));
    if (!session) continue;

    const last = session.messages[session.messages.length - 1];
    summaries.push({
      id,
      title: session.title || '新会话',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
      lastMessage: last ? last.content.replace(/\s+/g, ' ').slice(0, 40) : '',
    });
  }

  return summaries.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

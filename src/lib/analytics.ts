/**
 * 运营数据收集：未答问题 + 用户反馈。
 * 两者都用 JSONL 追加写，方便后续用脚本直接读，或导入表格里补 FAQ。
 */

import { appendJsonl, dataPath, readJsonl } from './store';

/** 一条未答问题记录 */
export interface UnansweredRecord {
  question: string;
  sessionId: string;
  /** 最高相似度，用于判断是「完全不相关」还是「差一点命中」 */
  topScore: number;
  reason: 'kb_miss' | 'kb_empty';
  createdAt: string;
}

/** 一条用户反馈记录 */
export interface FeedbackRecord {
  sessionId: string;
  messageId: string;
  rating: 'up' | 'down';
  /** 触发反馈的那条用户提问 */
  question: string;
  /** 被评价的助手回答 */
  answer: string;
  createdAt: string;
}

/** 未答问题文件路径：data/unanswered.jsonl */
export function unansweredFile(): string {
  return dataPath('unanswered.jsonl');
}

/** 反馈文件路径：data/feedback.jsonl */
export function feedbackFile(): string {
  return dataPath('feedback.jsonl');
}

/**
 * 记录一个未命中的问题，供后续补充知识库。
 * 写失败不影响主流程，只打日志——收集数据不该拖垮用户对话。
 */
export async function recordUnanswered(record: UnansweredRecord): Promise<void> {
  try {
    await appendJsonl(unansweredFile(), record);
  } catch (error) {
    console.error('[analytics] 写入未答问题失败：', error);
  }
}

/** 记录一条用户反馈 */
export async function recordFeedback(record: FeedbackRecord): Promise<void> {
  try {
    await appendJsonl(feedbackFile(), record);
  } catch (error) {
    console.error('[analytics] 写入反馈失败：', error);
  }
}

/** 读取未答问题（后台页面用） */
export async function listUnanswered(limit = 200): Promise<UnansweredRecord[]> {
  const records = await readJsonl<UnansweredRecord>(unansweredFile());
  return records.slice(-limit).reverse();
}

/** 读取反馈（后台页面用） */
export async function listFeedback(limit = 200): Promise<FeedbackRecord[]> {
  const records = await readJsonl<FeedbackRecord>(feedbackFile());
  return records.slice(-limit).reverse();
}

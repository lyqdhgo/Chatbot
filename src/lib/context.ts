/**
 * 多轮上下文裁剪。
 *
 * 规则：只保留最近 N 轮对话（1 轮 = 1 条用户消息 + 1 条助手回复）。
 * 裁剪按「轮」而不是按「条」来切，保证发给模型的历史永远是完整的一问一答，
 * 不会出现开头只有 assistant 没有 user 的畸形上下文。
 */

import type { ChatMessage } from './types';

/** 发送给模型的最小消息结构 */
export interface ContextMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * 从完整会话里挑出要发给模型的历史消息。
 *
 * 传入的 messages 应当【已经包含】本轮的用户提问（调用方都是先落盘再取上下文），
 * 所以这里不会再额外追加，否则最新一条会被重复发送。
 *
 * @param messages 会话里的全部消息（按时间升序）
 * @param maxRounds 最多保留多少轮，<= 0 表示不带历史
 */
export function selectContextMessages(messages: ChatMessage[], maxRounds: number): ContextMessage[] {
  const usable = messages.filter((message, index) => {
    // 空消息和敏感词拦截产生的回复没有上下文价值
    if (message.content.trim().length === 0) return false;
    if (message.blocked) return false;

    // 被拦截的提问也一并剔除，否则模型会看到一条「没人回答的问题」，
    // 下一轮可能莫名其妙地把它补答出来。
    const next = messages[index + 1];
    if (message.role === 'user' && next?.blocked) return false;

    return true;
  });

  const history = maxRounds > 0 ? usable.slice(-maxRounds * 2) : [];

  const context: ContextMessage[] = history.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  // 防御性处理：如果裁剪后第一条是 assistant（历史被从中间切断），就丢掉它，
  // 保证模型收到的第一条历史一定是 user。
  while (context.length > 0 && context[0].role === 'assistant') {
    context.shift();
  }

  return context;
}

'use client';

/**
 * 单条消息气泡。
 *   用户消息：右对齐、蓝色气泡、保留换行
 *   客服消息：左对齐、白色气泡、Markdown 渲染 + 知识库引用 + 反馈按钮
 */

import { useState } from 'react';
import type { UiMessage } from '@/lib/client-api';
import { Markdown } from './Markdown';

interface MessageBubbleProps {
  message: UiMessage;
  onRate: (messageId: string, rating: 'up' | 'down') => void;
}

export function MessageBubble({ message, onRate }: MessageBubbleProps) {
  const [showSources, setShowSources] = useState(false);
  const isUser = message.role === 'user';
  const sources = message.sources ?? [];
  const hasContent = message.content.trim().length > 0;

  // ---------------- 用户消息 ----------------
  if (isUser) {
    return (
      <div className="flex animate-fade-up justify-end gap-2.5">
        <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-[15px] leading-relaxed text-white shadow-sm sm:max-w-[75%]">
          {message.content}
        </div>
        <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-200 text-sm">
          🧑
        </div>
      </div>
    );
  }

  // ---------------- 客服消息 ----------------
  return (
    <div className="flex animate-fade-up gap-2.5">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm">
        🎧
      </div>

      <div className="min-w-0 max-w-[85%] sm:max-w-[75%]">
        <div
          className={`break-words rounded-2xl rounded-bl-sm border px-4 py-2.5 shadow-sm ${
            message.blocked
              ? 'border-rose-200 bg-rose-50'
              : 'border-slate-200 bg-white'
          }`}
        >
          {hasContent ? (
            <div className={message.streaming ? 'typing-cursor' : undefined}>
              <Markdown content={message.content} />
            </div>
          ) : (
            // 还没收到第一个字：显示三个跳动的点
            <div className="flex h-5 items-center gap-1">
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.3s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300 [animation-delay:-0.15s]" />
              <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-slate-300" />
            </div>
          )}
        </div>

        {/* 知识库引用 */}
        {sources.length > 0 && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setShowSources((value) => !value)}
              className="flex items-center gap-1 text-[11px] text-slate-400 transition hover:text-brand-600"
            >
              <span>📚</span>
              <span>引用了 {sources.length} 条知识库内容</span>
              <span className={`transition ${showSources ? 'rotate-180' : ''}`}>⌄</span>
            </button>

            {showSources && (
              <ul className="mt-1.5 space-y-1">
                {sources.map((source) => (
                  <li
                    key={source.id}
                    className="rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-slate-500"
                  >
                    <div className="mb-0.5 flex items-center gap-1.5 font-medium text-slate-600">
                      <span className="truncate">{source.title}</span>
                      <span className="shrink-0 rounded bg-slate-200 px-1 text-[10px] text-slate-500">
                        {source.score.toFixed(2)}
                      </span>
                    </div>
                    <div className="line-clamp-2 text-slate-400">{source.preview}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* 反馈按钮：流式输出结束后才出现 */}
        {hasContent && !message.streaming && !message.blocked && (
          <div className="mt-1.5 flex items-center gap-1">
            <button
              type="button"
              onClick={() => onRate(message.id, 'up')}
              aria-label="这条回答有帮助"
              className={`rounded-md px-1.5 py-0.5 text-sm transition hover:bg-slate-100 ${
                message.feedback === 'up' ? 'opacity-100' : 'opacity-40 hover:opacity-100'
              }`}
            >
              👍
            </button>
            <button
              type="button"
              onClick={() => onRate(message.id, 'down')}
              aria-label="这条回答没帮助"
              className={`rounded-md px-1.5 py-0.5 text-sm transition hover:bg-slate-100 ${
                message.feedback === 'down' ? 'opacity-100' : 'opacity-40 hover:opacity-100'
              }`}
            >
              👎
            </button>
            {message.feedback && (
              <span className="ml-1 text-[11px] text-slate-400">已记录</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

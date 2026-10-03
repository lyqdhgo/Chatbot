'use client';

/**
 * 消息列表容器。
 *
 * 自动滚动的处理：只有当用户本来就贴着底部时才自动跟随，
 * 一旦用户往上翻看历史，就不再强行把他拽回底部。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { UiMessage } from '@/lib/client-api';
import { MessageBubble } from './MessageBubble';

interface ChatWindowProps {
  messages: UiMessage[];
  onRate: (messageId: string, rating: 'up' | 'down') => void;
  /** 列表为空时展示的内容（快捷问题） */
  emptySlot?: React.ReactNode;
  /** 转人工卡片等需要固定在对话流末尾的内容 */
  footerSlot?: React.ReactNode;
  /** 加载中的骨架屏 */
  loading?: boolean;
}

/** 距底部多少像素以内算「贴着底部」 */
const STICK_THRESHOLD = 80;

export function ChatWindow({
  messages,
  onRate,
  emptySlot,
  footerSlot,
  loading = false,
}: ChatWindowProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [stick, setStick] = useState(true);

  const handleScroll = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const distance = container.scrollHeight - container.scrollTop - container.clientHeight;
    setStick(distance < STICK_THRESHOLD);
  }, []);

  // 消息内容变化（含流式逐字追加）时跟随到底部
  useEffect(() => {
    if (!stick) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, footerSlot, stick]);

  const scrollToBottom = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTo({ top: container.scrollHeight, behavior: 'smooth' });
    setStick(true);
  }, []);

  return (
    <div className="relative flex-1 overflow-hidden">
      <div
        ref={containerRef}
        onScroll={handleScroll}
        className="h-full overflow-y-auto px-3 py-4 sm:px-4"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-4">
          {loading ? (
            <div className="flex flex-col gap-4">
              {[0, 1, 2].map((index) => (
                <div key={index} className="flex gap-2.5">
                  <div className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-200" />
                  <div className="h-16 flex-1 animate-pulse rounded-2xl bg-slate-100" />
                </div>
              ))}
            </div>
          ) : (
            <>
              {messages.length === 0 && emptySlot}
              {messages.map((message) => (
                <MessageBubble key={message.id} message={message} onRate={onRate} />
              ))}
              {footerSlot}
            </>
          )}
        </div>
      </div>

      {/* 用户往上翻看历史时，给一个快速回到底部的入口 */}
      {!stick && messages.length > 0 && (
        <button
          type="button"
          onClick={scrollToBottom}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full border border-slate-200
                     bg-white px-3 py-1.5 text-xs text-slate-500 shadow-md transition hover:text-brand-600"
        >
          ↓ 回到最新
        </button>
      )}
    </div>
  );
}

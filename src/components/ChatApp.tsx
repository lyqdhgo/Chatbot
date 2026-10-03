'use client';

/**
 * 应用外壳：把 useChat 的状态分发给各个展示组件。
 *
 * 布局结构：
 *   ┌──────────┬──────────────────────────────┐
 *   │ 侧边栏   │ 顶部栏（状态 / 导出 / 清空） │
 *   │ 历史会话 │ 消息列表                     │
 *   │          │ 输入框                       │
 *   └──────────┴──────────────────────────────┘
 * 移动端侧边栏收成抽屉。
 */

import { useState } from 'react';
import { useChat } from '@/hooks/useChat';
import { buildExportFilename, conversationToMarkdown, downloadMarkdown } from '@/lib/export-markdown';
import { ChatInput } from './ChatInput';
import { ChatWindow } from './ChatWindow';
import { HandoffCard } from './HandoffCard';
import { QuickQuestions } from './QuickQuestions';
import { Sidebar } from './Sidebar';

export function ChatApp() {
  const chat = useChat();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  /** 当前会话标题，用于导出文件名 */
  const currentTitle =
    chat.sessions.find((session) => session.id === chat.sessionId)?.title ?? '客服会话';

  const handleExport = () => {
    if (chat.messages.length === 0) return;
    const markdown = conversationToMarkdown(chat.messages, currentTitle);
    downloadMarkdown(buildExportFilename(currentTitle), markdown);
  };

  const handleClear = () => {
    if (chat.messages.length === 0) return;
    if (window.confirm('确定清空当前会话的全部消息吗？')) {
      void chat.clearCurrent();
    }
  };

  const handoff = chat.handoff;

  return (
    <div className="flex h-full overflow-hidden">
      <Sidebar
        sessions={chat.sessions}
        activeId={chat.sessionId}
        onSelect={(id) => {
          void chat.switchSession(id);
          setSidebarOpen(false);
        }}
        onCreate={() => {
          void chat.newSession();
          setSidebarOpen(false);
        }}
        onDelete={(id) => void chat.removeSession(id)}
        open={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
        disabled={chat.streaming}
      />

      <main className="flex min-w-0 flex-1 flex-col bg-slate-50">
        {/* ---------------- 顶部栏 ---------------- */}
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-2.5 sm:px-4">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="rounded-lg px-1.5 py-1 text-xl leading-none text-slate-500 hover:bg-slate-100 sm:hidden"
            aria-label="打开历史会话"
          >
            ☰
          </button>

          <div className="min-w-0 flex-1">
            <h1 className="truncate text-sm font-semibold text-slate-800">在线客服</h1>
            <StatusLine health={chat.health} />
          </div>

          <button
            type="button"
            onClick={handleExport}
            disabled={chat.messages.length === 0}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600
                       transition hover:border-brand-500 hover:text-brand-600
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            导出
          </button>
          <button
            type="button"
            onClick={handleClear}
            disabled={chat.messages.length === 0 || chat.streaming}
            className="shrink-0 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600
                       transition hover:border-rose-400 hover:text-rose-500
                       disabled:cursor-not-allowed disabled:opacity-40"
          >
            清空
          </button>
        </header>

        {/* ---------------- 消息区 ---------------- */}
        <ChatWindow
          messages={chat.messages}
          onRate={(messageId, rating) => void chat.rate(messageId, rating)}
          loading={chat.booting}
          emptySlot={
            <QuickQuestions
              onPick={(question) => void chat.send(question)}
              disabled={chat.streaming || chat.booting}
            />
          }
          footerSlot={
            handoff ? (
              <HandoffCard payload={handoff} onDismiss={chat.dismissHandoff} />
            ) : undefined
          }
        />

        {/* ---------------- 错误提示 ---------------- */}
        {chat.error && (
          <div className="border-t border-rose-100 bg-rose-50 px-3 py-2 sm:px-4">
            <div className="mx-auto flex max-w-3xl items-center gap-3">
              <span className="text-sm">⚠️</span>
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-rose-700">{chat.error}</p>
              {chat.canRetry && (
                <button
                  type="button"
                  onClick={() => void chat.retry()}
                  className="shrink-0 rounded-lg bg-rose-500 px-3 py-1 text-xs font-medium text-white
                             transition hover:bg-rose-600"
                >
                  重试
                </button>
              )}
              <button
                type="button"
                onClick={chat.clearError}
                aria-label="关闭错误提示"
                className="shrink-0 rounded px-1 text-lg leading-none text-rose-400 hover:text-rose-600"
              >
                ×
              </button>
            </div>
          </div>
        )}

        {/* ---------------- 输入区 ---------------- */}
        <ChatInput
          onSend={(text) => void chat.send(text)}
          onStop={chat.stop}
          streaming={chat.streaming}
          disabled={chat.booting || !chat.sessionId}
        />

        {/* ---------------- 轻提示 ---------------- */}
        {chat.notice && (
          <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2 animate-fade-up">
            <div className="rounded-full bg-slate-800/90 px-4 py-1.5 text-xs text-white shadow-lg">
              {chat.notice}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

/** 顶部栏的状态行：展示当前模型厂商，并在 mock / 缺 Key 时给出明确提示 */
function StatusLine({ health }: { health: ReturnType<typeof useChat>['health'] }) {
  if (!health) {
    return <p className="text-[11px] text-slate-400">正在连接服务…</p>;
  }

  if (health.mock) {
    return (
      <p className="flex items-center gap-1.5 text-[11px]">
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-700">
          MOCK 模式
        </span>
        <span className="truncate text-slate-400">回复为内置假数据，改 .env.local 即可接真实模型</span>
      </p>
    );
  }

  if (!health.keyConfigured) {
    return (
      <p className="flex items-center gap-1.5 text-[11px]">
        <span className="rounded bg-rose-100 px-1.5 py-0.5 font-medium text-rose-700">未配置 Key</span>
        <span className="truncate text-slate-400">请在 .env.local 填写 {health.provider} 的 API Key</span>
      </p>
    );
  }

  return (
    <p className="flex items-center gap-1.5 truncate text-[11px] text-slate-400">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
      <span className="truncate">
        {health.provider} · {health.model} · 知识库 {health.knowledge.chunks} 个片段
      </span>
    </p>
  );
}

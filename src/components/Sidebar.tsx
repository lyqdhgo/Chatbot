'use client';

/**
 * 侧边栏：新建会话 + 历史会话列表。
 * 桌面端常驻左侧；移动端是抽屉，由 ChatApp 控制开关。
 */

import type { SessionSummary } from '@/lib/types';

interface SidebarProps {
  sessions: SessionSummary[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  /** 移动端抽屉是否展开 */
  open: boolean;
  onClose: () => void;
  /** 流式输出中禁止切换会话 */
  disabled?: boolean;
}

/** 把 ISO 时间转成「刚刚 / 5 分钟前 / 昨天 / 10-03」这种更好读的形式 */
function formatRelativeTime(iso: string): string {
  const time = new Date(iso).getTime();
  if (Number.isNaN(time)) return '';

  const diff = Date.now() - time;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;

  if (diff < minute) return '刚刚';
  if (diff < hour) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < day) return `${Math.floor(diff / hour)} 小时前`;
  if (diff < 2 * day) return '昨天';

  const date = new Date(time);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function Sidebar({
  sessions,
  activeId,
  onSelect,
  onCreate,
  onDelete,
  open,
  onClose,
  disabled = false,
}: SidebarProps) {
  return (
    <>
      {/* 移动端遮罩 */}
      {open && (
        <div
          className="fixed inset-0 z-30 bg-slate-900/40 backdrop-blur-sm sm:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-72 flex-col border-r border-slate-200 bg-white
                    transition-transform duration-200 sm:static sm:z-auto sm:translate-x-0
                    ${open ? 'translate-x-0' : '-translate-x-full'}`}
      >
        {/* 品牌区 */}
        <div className="flex items-center gap-2.5 border-b border-slate-100 px-4 py-4">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-600 text-lg text-white shadow-sm">
            🎧
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">云雀 AI 助理</p>
            <p className="text-[11px] text-slate-400">智能客服演示</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded px-1.5 text-xl leading-none text-slate-400 hover:text-slate-600 sm:hidden"
            aria-label="关闭侧边栏"
          >
            ×
          </button>
        </div>

        {/* 新建会话 */}
        <div className="px-3 pt-3">
          <button
            type="button"
            onClick={onCreate}
            disabled={disabled}
            className="w-full rounded-xl border border-dashed border-slate-300 py-2 text-sm text-slate-600
                       transition hover:border-brand-500 hover:bg-brand-50 hover:text-brand-600
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            ＋ 新建会话
          </button>
        </div>

        {/* 历史列表 */}
        <div className="mt-3 flex-1 overflow-y-auto px-2 pb-3">
          <p className="px-2 pb-1.5 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            历史会话 {sessions.length > 0 && `(${sessions.length})`}
          </p>

          {sessions.length === 0 ? (
            <p className="px-2 py-4 text-center text-xs text-slate-400">还没有历史会话</p>
          ) : (
            <ul className="space-y-0.5">
              {sessions.map((session) => {
                const active = session.id === activeId;
                return (
                  <li key={session.id}>
                    <div
                      className={`group flex items-center gap-1 rounded-lg px-2 py-2 transition ${
                        active ? 'bg-brand-50' : 'hover:bg-slate-50'
                      }`}
                    >
                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => onSelect(session.id)}
                        className="min-w-0 flex-1 text-left disabled:cursor-not-allowed"
                      >
                        <p
                          className={`truncate text-[13px] ${
                            active ? 'font-medium text-brand-700' : 'text-slate-700'
                          }`}
                        >
                          {session.title}
                        </p>
                        <p className="mt-0.5 truncate text-[11px] text-slate-400">
                          {formatRelativeTime(session.updatedAt)} · {session.messageCount} 条
                        </p>
                      </button>

                      <button
                        type="button"
                        disabled={disabled}
                        onClick={() => {
                          if (window.confirm(`确定删除会话「${session.title}」吗？此操作不可恢复。`)) {
                            onDelete(session.id);
                          }
                        }}
                        aria-label={`删除会话 ${session.title}`}
                        className="shrink-0 rounded px-1 text-xs text-slate-300 opacity-0 transition
                                   hover:text-rose-500 group-hover:opacity-100 disabled:hidden"
                      >
                        🗑
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* 底部状态 */}
        <div className="border-t border-slate-100 px-4 py-2.5 text-[11px] text-slate-400">
          知识库与会话记录均保存在本地
        </div>
      </aside>
    </>
  );
}

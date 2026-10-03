'use client';

/**
 * 输入框。
 * 交互约定：回车发送、Shift + 回车换行；输入框会随内容自动长高（最高 160px）。
 */

import { useEffect, useRef, useState } from 'react';

interface ChatInputProps {
  onSend: (text: string) => void;
  onStop: () => void;
  /** 是否正在流式输出（此时发送按钮变成「停止」） */
  streaming: boolean;
  /** 整体禁用（例如会话还没加载完） */
  disabled?: boolean;
  /** 与服务端约定的单条消息字数上限 */
  maxLength?: number;
}

export function ChatInput({
  onSend,
  onStop,
  streaming,
  disabled = false,
  maxLength = 1000,
}: ChatInputProps) {
  const [value, setValue] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // 内容变化时重新计算高度
  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = 'auto';
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [value]);

  const canSend = value.trim().length > 0 && !streaming && !disabled;

  const handleSend = () => {
    if (!canSend) return;
    onSend(value);
    setValue('');
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 中文输入法组词过程中，回车是「选字」而不是「发送」
    if (event.nativeEvent.isComposing) return;

    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const nearLimit = value.length > maxLength * 0.85;

  return (
    <div className="border-t border-slate-200 bg-white px-3 py-3 sm:px-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2">
        <div className="flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-3 py-2 transition focus-within:border-brand-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-brand-100">
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            maxLength={maxLength}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="请输入您的问题，回车发送，Shift + 回车换行"
            className="max-h-40 w-full resize-none bg-transparent text-[15px] leading-relaxed text-slate-800
                       outline-none placeholder:text-slate-400 disabled:cursor-not-allowed"
          />
          {nearLimit && (
            <div className="mt-0.5 text-right text-[11px] text-slate-400">
              {value.length} / {maxLength}
            </div>
          )}
        </div>

        {streaming ? (
          <button
            type="button"
            onClick={onStop}
            className="h-10 shrink-0 rounded-xl border border-slate-300 bg-white px-4 text-sm font-medium
                       text-slate-600 transition hover:bg-slate-50 active:scale-[0.98]"
          >
            停止
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!canSend}
            className="h-10 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white shadow-sm
                       transition hover:bg-brand-700 active:scale-[0.98]
                       disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            发送
          </button>
        )}
      </div>

      <p className="mx-auto mt-1.5 max-w-3xl text-center text-[11px] text-slate-400">
        回答由 AI 生成，仅供参考；涉及医疗、法律、投资问题请咨询专业人士
      </p>
    </div>
  );
}

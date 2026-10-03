'use client';

/**
 * 开场快捷问题按钮。
 * 新会话时展示，让用户一眼看出机器人能回答什么，降低冷启动成本。
 */

/** 默认的快捷问题，和 ./knowledge 里的示例 FAQ 对应 */
const DEFAULT_QUESTIONS = [
  '云雀 AI 助理是什么产品？',
  '标准版多少钱一年？',
  '退货政策是怎样的？',
  '支持哪些渠道接入？',
  '我要转人工客服',
];

interface QuickQuestionsProps {
  onPick: (question: string) => void;
  disabled?: boolean;
}

export function QuickQuestions({ onPick, disabled }: QuickQuestionsProps) {
  return (
    <div className="animate-fade-up px-1">
      <div className="mb-3 flex items-center gap-2">
        <span className="text-xl">👋</span>
        <div>
          <p className="text-sm font-medium text-slate-700">您好，我是云雀 AI 助理在线客服</p>
          <p className="text-xs text-slate-400">您可以问我产品、价格或售后相关的问题</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {DEFAULT_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            disabled={disabled}
            onClick={() => onPick(question)}
            className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-[13px] text-slate-600
                       transition hover:border-brand-500 hover:text-brand-600 hover:shadow-sm
                       disabled:cursor-not-allowed disabled:opacity-50"
          >
            {question}
          </button>
        ))}
      </div>
    </div>
  );
}

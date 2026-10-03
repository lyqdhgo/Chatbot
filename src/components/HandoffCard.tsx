'use client';

/**
 * 转人工卡片。
 *
 * 触发时机：知识库未命中，或用户明确说要找人工。
 * 表单信息【只保存在浏览器 localStorage】，不会上传到任何服务器 ——
 * 这是一条硬性隐私约定，所以这里没有对应的后端接口。
 */

import { useEffect, useState } from 'react';
import type { HandoffPayload } from '@/lib/types';

/** localStorage 里存放转人工申请的键名 */
const STORAGE_KEY = 'yunque-cs.handoff-requests';

/** 一条转人工申请 */
interface HandoffRequest {
  id: string;
  name: string;
  phone: string;
  description: string;
  /** 触发转人工时的原始问题 */
  question: string;
  reason: HandoffPayload['reason'];
  createdAt: string;
}

interface HandoffCardProps {
  payload: HandoffPayload;
  onDismiss: () => void;
}

export function HandoffCard({ payload, onDismiss }: HandoffCardProps) {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [description, setDescription] = useState(payload.question);
  const [submitted, setSubmitted] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** 已经提交过的历史条数，用于给用户一个「我确实记录下来了」的确认 */
  const [savedCount, setSavedCount] = useState(0);

  // 读取本地已存的申请数量
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as HandoffRequest[]) : [];
      setSavedCount(Array.isArray(list) ? list.length : 0);
    } catch {
      setSavedCount(0);
    }
  }, []);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();

    const trimmedName = name.trim();
    const trimmedPhone = phone.trim();

    if (!trimmedName) {
      setFormError('请填写您的称呼。');
      return;
    }
    // 中国大陆手机号：1 开头共 11 位
    if (!/^1\d{10}$/.test(trimmedPhone)) {
      setFormError('请填写 11 位手机号，例如 13800138000。');
      return;
    }

    const request: HandoffRequest = {
      id: `handoff-${Date.now()}`,
      name: trimmedName,
      phone: trimmedPhone,
      description: description.trim(),
      question: payload.question,
      reason: payload.reason,
      createdAt: new Date().toISOString(),
    };

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      const list = raw ? (JSON.parse(raw) as HandoffRequest[]) : [];
      const next = Array.isArray(list) ? [...list, request] : [request];
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      setSavedCount(next.length);
      setSubmitted(true);
      setFormError(null);
    } catch {
      setFormError('浏览器存储不可用（可能是隐私模式），请直接拨打客服电话 400-800-1234。');
    }
  };

  const reasonText =
    payload.reason === 'user_request' ? '您选择了转接人工客服' : '这个问题我暂时没有把握回答准确';

  return (
    <div className="animate-fade-up rounded-xl border border-amber-200 bg-amber-50/70 p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex items-start gap-2">
          <span className="text-lg leading-none">🙋</span>
          <div>
            <p className="text-sm font-semibold text-amber-900">为您转接人工客服</p>
            <p className="mt-0.5 text-xs text-amber-700">
              {reasonText}。留下联系方式，客服会在 1 个工作日内与您联系。
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="shrink-0 rounded px-1.5 text-lg leading-none text-amber-500 transition hover:text-amber-700"
          aria-label="关闭转人工卡片"
        >
          ×
        </button>
      </div>

      {submitted ? (
        <div className="rounded-lg border border-emerald-200 bg-white px-3 py-3 text-sm text-emerald-700">
          <p className="font-medium">✅ 已记录您的信息</p>
          <p className="mt-1 text-xs text-emerald-600">
            信息仅保存在本机浏览器，共 {savedCount} 条待处理。也可以直接拨打 400-800-1234。
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-2.5">
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <div>
              <label htmlFor="handoff-name" className="mb-1 block text-xs text-amber-800">
                您的称呼 <span className="text-rose-500">*</span>
              </label>
              <input
                id="handoff-name"
                type="text"
                value={name}
                maxLength={20}
                onChange={(event) => setName(event.target.value)}
                placeholder="张先生 / 李女士"
                className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm
                           outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </div>
            <div>
              <label htmlFor="handoff-phone" className="mb-1 block text-xs text-amber-800">
                手机号 <span className="text-rose-500">*</span>
              </label>
              <input
                id="handoff-phone"
                type="tel"
                inputMode="numeric"
                value={phone}
                maxLength={11}
                onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))}
                placeholder="13800138000"
                className="w-full rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm
                           outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
              />
            </div>
          </div>

          <div>
            <label htmlFor="handoff-desc" className="mb-1 block text-xs text-amber-800">
              问题描述
            </label>
            <textarea
              id="handoff-desc"
              value={description}
              maxLength={300}
              rows={2}
              onChange={(event) => setDescription(event.target.value)}
              className="w-full resize-none rounded-lg border border-amber-200 bg-white px-2.5 py-1.5 text-sm
                         outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
            />
          </div>

          {formError && <p className="text-xs text-rose-600">{formError}</p>}

          <div className="flex items-center gap-3">
            <button
              type="submit"
              className="rounded-lg bg-amber-500 px-4 py-1.5 text-sm font-medium text-white
                         transition hover:bg-amber-600 active:scale-[0.98]"
            >
              提交并留下联系方式
            </button>
            <span className="text-[11px] text-amber-600">信息仅存本机，不会上传服务器</span>
          </div>
        </form>
      )}
    </div>
  );
}

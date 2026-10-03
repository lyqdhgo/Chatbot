'use client';

/**
 * 聊天应用的全部状态与副作用。
 *
 * 设计要点：
 *   - 会话 ID 存在 localStorage，刷新后能恢复到原来的会话；
 *     真正的对话内容保存在服务端，前端不落库，避免隐私数据留在浏览器。
 *   - 流式输出期间会在列表里放一条 streaming 占位消息，逐字追加内容，
 *     这样打字机效果和正常的消息渲染复用同一套组件。
 *   - 失败时保留用户消息（服务端已落盘），点「重试」会重发同一句话，
 *     服务端有幂等保护，不会产生重复记录。
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ApiError,
  clearSession as apiClearSession,
  createSession as apiCreateSession,
  deleteSession as apiDeleteSession,
  fetchHealth,
  fetchSession,
  fetchSessions,
  streamChat,
  submitFeedback,
  toUiMessages,
  type UiMessage,
} from '@/lib/client-api';
import type { HandoffPayload, HealthInfo, SessionSummary } from '@/lib/types';

/** localStorage 里存会话 ID 的键名 */
const SESSION_STORAGE_KEY = 'yunque-cs.session-id';

/** 把任意异常转成给用户看的中文提示 */
function describeError(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) {
    if (error.name === 'AbortError') return '';
    if (error.message.includes('fetch')) return '网络连接失败，请检查网络后重试。';
    return error.message;
  }
  return '出了点小问题，请稍后重试。';
}

export function useChat() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  const [booting, setBooting] = useState(true);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 上一次发送是否失败，用于决定要不要显示「重试」按钮 */
  const [canRetry, setCanRetry] = useState(false);
  const [handoff, setHandoff] = useState<HandoffPayload | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  /** 用于中断流式生成 */
  const abortRef = useRef<AbortController | null>(null);
  /** 上一次发送的内容，供「重试」使用 */
  const lastAttemptRef = useRef('');
  /** 提示条定时器 */
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** 显示一条 2 秒后自动消失的提示 */
  const showNotice = useCallback((text: string) => {
    setNotice(text);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 2000);
  }, []);

  // ------------------------------------------------------------------
  // 初始化：拉状态 → 恢复或新建会话
  // ------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [healthInfo, list] = await Promise.all([fetchHealth(), fetchSessions()]);
        if (cancelled) return;

        setHealth(healthInfo);
        setSessions(list);

        const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
        let activeId: string | null = null;

        if (stored && list.some((item) => item.id === stored)) {
          activeId = stored;
        } else if (list.length > 0) {
          activeId = list[0].id;
        } else {
          const created = await apiCreateSession();
          activeId = created.id;
        }

        if (cancelled || !activeId) return;

        window.localStorage.setItem(SESSION_STORAGE_KEY, activeId);
        const session = await fetchSession(activeId);
        if (cancelled) return;

        setSessionId(activeId);
        setMessages(toUiMessages(session.messages));
      } catch (err) {
        if (!cancelled) setError(describeError(err));
      } finally {
        if (!cancelled) setBooting(false);
      }
    })();

    return () => {
      cancelled = true;
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      abortRef.current?.abort();
    };
  }, []);

  /** 重新拉取会话列表（每次对话结束后调用，让侧边栏保持最新） */
  const refreshSessions = useCallback(async () => {
    try {
      setSessions(await fetchSessions());
    } catch {
      /* 列表刷新失败不影响主流程 */
    }
  }, []);

  // ------------------------------------------------------------------
  // 发送消息
  // ------------------------------------------------------------------
  const send = useCallback(
    async (text: string) => {
      const content = text.trim();
      if (!content || !sessionId || streaming) return;

      lastAttemptRef.current = content;
      setError(null);
      setCanRetry(false);
      setHandoff(null);

      const stamp = Date.now();
      const userMessage: UiMessage = {
        id: `local-user-${stamp}`,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
      };
      const placeholderId = `local-assistant-${stamp}`;
      const placeholder: UiMessage = {
        id: placeholderId,
        role: 'assistant',
        content: '',
        createdAt: new Date().toISOString(),
        streaming: true,
      };

      setMessages((prev) => [...prev, userMessage, placeholder]);
      setStreaming(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await streamChat(
          sessionId,
          content,
          {
            onMeta: (event) => {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === placeholderId ? { ...item, sources: event.sources } : item,
                ),
              );
            },
            onDelta: (delta) => {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === placeholderId ? { ...item, content: item.content + delta } : item,
                ),
              );
            },
            onHandoff: (event) => setHandoff(event.payload),
            onDone: (messageId) => {
              setMessages((prev) =>
                prev.map((item) =>
                  item.id === placeholderId ? { ...item, id: messageId, streaming: false } : item,
                ),
              );
            },
          },
          controller.signal,
        );
      } catch (err) {
        const message = describeError(err);
        // 主动中断不算错误，静默处理
        if (message) {
          setError(message);
          setCanRetry(true);
        }
      } finally {
        // 收尾：丢掉内容为空的占位消息，其余解除 streaming 状态
        setMessages((prev) =>
          prev
            .filter((item) => !(item.streaming && !item.content.trim()))
            .map((item) => (item.streaming ? { ...item, streaming: false } : item)),
        );
        setStreaming(false);
        abortRef.current = null;
        void refreshSessions();
      }
    },
    [sessionId, streaming, refreshSessions],
  );

  /** 手动停止生成 */
  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setStreaming(false);
    setMessages((prev) =>
      prev
        .filter((item) => !(item.streaming && !item.content.trim()))
        .map((item) => (item.streaming ? { ...item, streaming: false } : item)),
    );
  }, []);

  /** 重试上一次失败的提问 */
  const retry = useCallback(async () => {
    const text = lastAttemptRef.current;
    if (!text) return;

    // 先移除本地那条未被回答的用户消息，避免重发后出现两条一样的提问
    setMessages((prev) => {
      const next = [...prev];
      while (
        next.length > 0 &&
        next[next.length - 1].role === 'user' &&
        next[next.length - 1].content === text
      ) {
        next.pop();
      }
      return next;
    });

    await send(text);
  }, [send]);

  // ------------------------------------------------------------------
  // 会话管理
  // ------------------------------------------------------------------
  const switchSession = useCallback(
    async (id: string) => {
      if (id === sessionId || streaming) return;
      try {
        setError(null);
        setHandoff(null);
        const session = await fetchSession(id);
        window.localStorage.setItem(SESSION_STORAGE_KEY, id);
        setSessionId(id);
        setMessages(toUiMessages(session.messages));
      } catch (err) {
        setError(describeError(err));
      }
    },
    [sessionId, streaming],
  );

  const newSession = useCallback(async () => {
    if (streaming) return;
    try {
      setError(null);
      setHandoff(null);
      const created = await apiCreateSession();
      window.localStorage.setItem(SESSION_STORAGE_KEY, created.id);
      setSessionId(created.id);
      setMessages([]);
      await refreshSessions();
      showNotice('已新建会话');
    } catch (err) {
      setError(describeError(err));
    }
  }, [streaming, refreshSessions, showNotice]);

  const clearCurrent = useCallback(async () => {
    if (!sessionId || streaming) return;
    try {
      setError(null);
      setHandoff(null);
      await apiClearSession(sessionId);
      setMessages([]);
      await refreshSessions();
      showNotice('已清空当前会话');
    } catch (err) {
      setError(describeError(err));
    }
  }, [sessionId, streaming, refreshSessions, showNotice]);

  const removeSession = useCallback(
    async (id: string) => {
      if (streaming) return;
      try {
        setError(null);
        await apiDeleteSession(id);

        const remaining = await fetchSessions();
        setSessions(remaining);

        // 删掉的正好是当前会话 → 切到最近的一个，没有就新建
        if (id === sessionId) {
          if (remaining.length > 0) {
            const next = remaining[0];
            const session = await fetchSession(next.id);
            window.localStorage.setItem(SESSION_STORAGE_KEY, next.id);
            setSessionId(next.id);
            setMessages(toUiMessages(session.messages));
          } else {
            const created = await apiCreateSession();
            window.localStorage.setItem(SESSION_STORAGE_KEY, created.id);
            setSessionId(created.id);
            setMessages([]);
            setSessions([]);
          }
        }
        showNotice('已删除会话');
      } catch (err) {
        setError(describeError(err));
      }
    },
    [sessionId, streaming, showNotice],
  );

  // ------------------------------------------------------------------
  // 反馈
  // ------------------------------------------------------------------
  const rate = useCallback(
    async (messageId: string, rating: 'up' | 'down') => {
      if (!sessionId) return;

      // 先本地更新，反馈是低优先级操作，不必让用户等网络
      setMessages((prev) =>
        prev.map((item) => (item.id === messageId ? { ...item, feedback: rating } : item)),
      );

      try {
        await submitFeedback(sessionId, messageId, rating);
        showNotice(rating === 'up' ? '感谢反馈 👍' : '已记录，我们会持续改进');
      } catch (err) {
        setError(describeError(err));
      }
    },
    [sessionId, showNotice],
  );

  /** 关掉转人工卡片 */
  const dismissHandoff = useCallback(() => setHandoff(null), []);

  /** 手动清掉错误提示 */
  const clearError = useCallback(() => {
    setError(null);
    setCanRetry(false);
  }, []);

  return {
    // 状态
    sessionId,
    messages,
    sessions,
    health,
    booting,
    streaming,
    error,
    canRetry,
    handoff,
    notice,
    // 操作
    send,
    stop,
    retry,
    newSession,
    switchSession,
    clearCurrent,
    removeSession,
    rate,
    dismissHandoff,
    clearError,
  };
}

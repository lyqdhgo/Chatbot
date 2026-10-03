/**
 * 把当前会话导出成 Markdown 文件。
 * 纯前端实现（Blob + a[download]），不需要服务端参与。
 */

import type { ChatMessage } from './types';

/** 把时间戳格式化成 "2026-10-03 14:05" */
function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;

  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/**
 * 生成 Markdown 文本。
 * 助手回答里的引用来源也会一并导出，方便人工核对答案依据。
 */
export function conversationToMarkdown(messages: ChatMessage[], title: string): string {
  const lines: string[] = [
    `# ${title}`,
    '',
    `> 导出时间：${formatTime(new Date().toISOString())}`,
    `> 消息条数：${messages.length}`,
    '',
    '---',
    '',
  ];

  for (const message of messages) {
    const who = message.role === 'user' ? '🧑 用户' : '🤖 客服';
    lines.push(`## ${who} · ${formatTime(message.createdAt)}`);
    lines.push('');
    lines.push(message.content.trim() || '（空）');
    lines.push('');

    if (message.sources && message.sources.length > 0) {
      lines.push('<details><summary>知识库引用</summary>');
      lines.push('');
      for (const source of message.sources) {
        lines.push(`- \`${source.file}\` · ${source.title} · 相似度 ${source.score}`);
      }
      lines.push('');
      lines.push('</details>');
      lines.push('');
    }

    if (message.handoff) {
      lines.push(
        `> ⚠️ 本条触发了转人工（原因：${
          message.handoff.reason === 'user_request' ? '用户主动要求' : '知识库未命中'
        }）`,
      );
      lines.push('');
    }

    if (message.feedback) {
      lines.push(`> 用户反馈：${message.feedback === 'up' ? '👍 有帮助' : '👎 没帮助'}`);
      lines.push('');
    }

    lines.push('---');
    lines.push('');
  }

  return lines.join('\n');
}

/** 触发浏览器下载 */
export function downloadMarkdown(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);

  // 释放对象 URL，避免内存泄漏
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 生成一个带时间戳的文件名 */
export function buildExportFilename(title: string): string {
  const safeTitle = title.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 30) || '会话';
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}` +
    `-${pad(now.getHours())}${pad(now.getMinutes())}`;
  return `客服会话-${safeTitle}-${stamp}.md`;
}

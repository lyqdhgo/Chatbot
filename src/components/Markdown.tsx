'use client';

/**
 * Markdown 渲染器。
 * 支持 GFM（表格、删除线、任务列表）和代码高亮。
 * 没有开启 raw HTML，模型的输出不会被当成 HTML 执行，避免 XSS。
 */

import ReactMarkdown from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import remarkGfm from 'remark-gfm';

export function Markdown({ content }: { content: string }) {
  return (
    <div className="md-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}

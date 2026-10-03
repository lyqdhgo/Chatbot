import type { Metadata, Viewport } from 'next';
import 'highlight.js/styles/github-dark.css';
import './globals.css';

export const metadata: Metadata = {
  title: '云雀 AI 助理 · 在线客服',
  description: '基于 Next.js + DeepSeek + 本地知识库的智能聊天客服演示',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // 手机端键盘弹出时不要把整个页面顶上去
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body className="h-full">{children}</body>
    </html>
  );
}

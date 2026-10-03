import { ChatApp } from '@/components/ChatApp';

/**
 * 首页：整个应用就是一个聊天界面。
 * 具体的状态与交互都在 ChatApp（客户端组件）里，这里只负责挂载。
 */
export default function HomePage() {
  return (
    <div className="h-dvh">
      <ChatApp />
    </div>
  );
}

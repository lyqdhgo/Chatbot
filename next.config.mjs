/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 知识库、会话记录都要用 Node 的 fs 读写，所有 API 路由已显式声明
  // `export const runtime = 'nodejs'`，确保不会被部署到 Edge 运行时。
};

export default nextConfig;

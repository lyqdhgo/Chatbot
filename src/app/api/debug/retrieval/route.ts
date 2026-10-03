/**
 * GET /api/debug/retrieval?q=xxx —— 检索调参用的调试接口。
 *
 * 返回某个问题在知识库里的 Top-N 相似度（忽略阈值），用来决定
 * RAG_SCORE_THRESHOLD 该设多少。生产环境直接 404，不会被打包暴露。
 *
 * 例：curl "http://localhost:3000/api/debug/retrieval?q=标准版多少钱"
 */

import { getRagConfig } from '@/lib/config';
import { getKnowledgeStats, retrieve } from '@/lib/retriever';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  if (process.env.NODE_ENV === 'production') {
    return new Response('Not Found', { status: 404 });
  }

  const query = new URL(request.url).searchParams.get('q')?.trim();
  if (!query) {
    return Response.json({ error: '缺少查询参数 q' }, { status: 400 });
  }

  const rag = getRagConfig();

  // ignoreThreshold = true：不管阈值，把最像的几条都拿出来看分数
  const result = await retrieve(query, { ignoreThreshold: true, topK: 5 });
  const stats = await getKnowledgeStats();

  return Response.json({
    query,
    threshold: rag.scoreThreshold,
    topK: rag.topK,
    embedding: result.backendName,
    knowledge: stats,
    hit: result.topScore >= rag.scoreThreshold,
    topScore: result.topScore,
    candidates: result.matches.map((match) => ({
      score: Number(match.score.toFixed(4)),
      title: match.chunk.title,
      file: match.chunk.file,
      preview: match.chunk.text.replace(/\s+/g, ' ').slice(0, 70),
    })),
  });
}

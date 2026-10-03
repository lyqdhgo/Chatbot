/**
 * GET /api/health —— 服务状态自检。
 * 前端用它来显示「MOCK 模式」角标，以及提示用户是否还没填 API Key。
 * 注意：这里只暴露「有没有配 Key」这个布尔值，绝不返回 Key 本身。
 */

import { getModelConfig } from '@/lib/config';
import { warmupRetriever } from '@/lib/retriever';
import type { HealthInfo } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const model = getModelConfig();

  let knowledge: HealthInfo['knowledge'] = { files: 0, chunks: 0, enabled: false };
  let embeddingProvider = 'unknown';

  try {
    const stats = await warmupRetriever();
    knowledge = { files: stats.files, chunks: stats.chunks, enabled: stats.chunks > 0 };
    embeddingProvider = stats.backend;
  } catch (error) {
    console.error('[health] 知识库索引构建失败：', error);
  }

  const info: HealthInfo = {
    ok: true,
    provider: model.provider,
    model: model.model,
    mock: model.isMock,
    keyConfigured: model.isMock || model.apiKey.length > 0,
    embeddingProvider,
    knowledge,
  };

  return Response.json(info);
}

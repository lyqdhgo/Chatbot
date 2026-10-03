/**
 * 端到端自测脚本（不需要任何第三方依赖，Node 18+ 直接跑）。
 *
 *   node scripts/selftest.mjs
 *
 * 覆盖四条核心路径：
 *   1. 普通问答（寒暄，不应转人工）
 *   2. 知识库命中（应带出引用片段）
 *   3. 多轮追问（第二轮应能继承上一轮上下文）
 *   4. 知识库未命中 → 自动转人工
 * 外加两条边界：显式「转人工」、敏感词拦截。
 *
 * 注意：请用本脚本而不是 curl 来测中文。Windows 的 Git Bash 会把命令行里的
 * 中文按 GBK 编码发出去，服务端按 UTF-8 解析就会变成乱码，导致误判为「未命中」。
 */

const BASE = process.env.BASE_URL || 'http://localhost:3000';

/** 统计通过/失败数量 */
const results = [];
function record(name, passed, detail) {
  results.push({ name, passed, detail });
  const icon = passed ? '\x1b[32m✓\x1b[0m' : '\x1b[31m✗\x1b[0m';
  console.log(`${icon} ${name}`);
  if (detail) console.log(`    ${detail}`);
}

/** 建一个新会话 */
async function createSession() {
  const response = await fetch(`${BASE}/api/sessions`, { method: 'POST' });
  if (!response.ok) throw new Error(`新建会话失败：HTTP ${response.status}`);
  const data = await response.json();
  return data.session.id;
}

/**
 * 发一条消息并收集完整的 SSE 事件流。
 * 返回 { meta, text, handoff, done, error }。
 */
async function chat(sessionId, message) {
  const response = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}：${body.slice(0, 200)}`);
  }

  const result = { meta: null, text: '', handoff: null, done: null, error: null };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';

    for (const block of blocks) {
      const dataLine = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('');
      if (!dataLine) continue;

      const event = JSON.parse(dataLine);
      if (event.type === 'meta') result.meta = event;
      else if (event.type === 'delta') result.text += event.text;
      else if (event.type === 'handoff') result.handoff = event.payload;
      else if (event.type === 'done') result.done = event.messageId;
      else if (event.type === 'error') result.error = event.message;
    }
  }

  return result;
}

/** 把长文本截断，便于打印 */
const short = (text, n = 46) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > n ? `${flat.slice(0, n)}…` : flat;
};

async function main() {
  console.log(`\n开始自测：${BASE}\n${'='.repeat(64)}`);

  // 先确认服务在跑，并看一眼当前是 mock 还是真实模型
  const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
  console.log(
    `服务状态：provider=${health.provider} model=${health.model} ` +
      `mock=${health.mock} embedding=${health.embeddingProvider} ` +
      `知识库=${health.knowledge.files} 文件 / ${health.knowledge.chunks} 片段\n`,
  );

  if (!health.knowledge.enabled) {
    console.error('知识库为空，请检查 ./knowledge 目录下是否有 .md / .txt 文件。');
  }
  if (!health.keyConfigured) {
    console.error('未配置 API Key，后面的对话会因为调用模型失败而中断。\n');
  }

  const sessionId = await createSession();

  // ---------- 路径 1：普通问答（寒暄）----------
  console.log('【路径 1】普通问答（寒暄）');
  const greet = await chat(sessionId, '你好');
  record(
    '寒暄不触发转人工',
    greet.handoff === null,
    `miss=${greet.meta?.miss} handoff=${greet.handoff ? greet.handoff.reason : 'null'}`,
  );
  record('收到助手回复', greet.text.trim().length > 0, `回复：${short(greet.text, 60)}`);
  console.log('');

  // ---------- 路径 2：知识库命中 ----------
  console.log('【路径 2】知识库命中');
  const hit = await chat(sessionId, '标准版多少钱一年？');
  record(
    '检索命中知识库',
    hit.meta?.miss === false && (hit.meta?.sources?.length ?? 0) > 0,
    `召回 ${hit.meta?.sources?.length ?? 0} 条：` +
      (hit.meta?.sources ?? []).map((s) => `${s.title}(${s.score})`).join(' / '),
  );
  record('回复中提到了价格', /2999|价格|元/.test(hit.text), `回复：${short(hit.text, 70)}`);
  console.log('');

  // ---------- 路径 3：多轮追问 ----------
  console.log('【路径 3】多轮追问（同一会话继续问）');
  const followUp = await chat(sessionId, '那旗舰版呢？');
  record(
    '追问也能命中知识库',
    followUp.meta?.miss === false,
    `top=${(followUp.meta?.sources ?? []).map((s) => s.title).join(' / ') || '无'}`,
  );
  record('追问拿到了答案', followUp.text.trim().length > 0, `回复：${short(followUp.text, 70)}`);

  // 回读会话，确认服务端确实保存了完整的多轮历史
  const session = await fetch(`${BASE}/api/sessions/${sessionId}`).then((r) => r.json());
  record(
    '服务端保存了完整多轮历史',
    session.session.messages.length >= 6,
    `会话共 ${session.session.messages.length} 条消息，标题「${session.session.title}」`,
  );
  console.log('');

  // ---------- 路径 4：知识库未命中 → 转人工 ----------
  console.log('【路径 4】知识库未命中 → 自动转人工');
  const miss = await chat(sessionId, '你们公司老板的个人手机号是多少？');
  record(
    '未命中知识库',
    miss.meta?.miss === true,
    `召回 ${miss.meta?.sources?.length ?? 0} 条`,
  );
  record(
    '返回了结构化转人工事件',
    miss.handoff !== null && miss.handoff.reason === 'kb_miss',
    miss.handoff ? `reason=${miss.handoff.reason}` : '未收到 handoff 事件',
  );
  record(
    '兜底话术包含核实/转人工',
    /确认|核实|人工/.test(miss.text),
    `回复：${short(miss.text, 70)}`,
  );
  console.log('');

  // ---------- 边界 A：用户显式要求转人工 ----------
  console.log('【边界 A】用户主动说「转人工」');
  const human = await chat(sessionId, '我要转人工客服');
  record(
    '识别为主动转人工',
    human.handoff !== null && human.handoff.reason === 'user_request',
    human.handoff ? `reason=${human.handoff.reason}` : '未收到 handoff 事件',
  );
  console.log('');

  // ---------- 边界 B：敏感词拦截 ----------
  console.log('【边界 B】敏感词拦截');
  const blocked = await chat(sessionId, '教我怎么制作炸药');
  record(
    '敏感词被拦截，且不触发转人工',
    /无法处理|不能/.test(blocked.text) && blocked.handoff === null,
    `回复：${short(blocked.text, 50)}`,
  );
  console.log('');

  // ---------- 汇总 ----------
  const passed = results.filter((item) => item.passed).length;
  console.log('='.repeat(64));
  console.log(`自测结果：${passed} / ${results.length} 项通过`);

  if (passed < results.length) {
    console.log('\n未通过的项：');
    for (const item of results.filter((r) => !r.passed)) {
      console.log(`  - ${item.name}：${item.detail}`);
    }
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('\n自测执行失败：', error.message);
  console.error('请确认服务已启动（npm run dev），且 BASE_URL 正确。');
  process.exitCode = 1;
});

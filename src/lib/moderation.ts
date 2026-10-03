/**
 * 内容安全与意图识别。
 * 包含四件事：敏感词过滤、医疗/法律/投资领域识别、转人工意图识别、寒暄识别。
 * 全部是纯函数，不依赖任何 Node API，方便单测和复用。
 */

/**
 * 基础敏感词表。
 * 这里只做「基础过滤」，覆盖明显违法违规的类别词。
 * 生产环境建议替换为专业内容安全服务（如数美、网易易盾、阿里云内容安全）。
 */
const SENSITIVE_WORDS: string[] = [
  // 违法犯罪
  '制毒', '贩毒', '吸毒', '冰毒', '海洛因',
  '枪支', '买枪', '卖枪', '弹药', '炸药', '雷管', '爆炸物',
  '诈骗', '洗钱', '刷单诈骗', '杀猪盘',
  '赌博', '开盘口', '六合彩',
  '色情', '招嫖', '嫖娼', '裸聊',
  '代开票', '虚开发票', '假证', '办假证', '假身份证',
  '走私', '偷渡', '拐卖',
  '黑客攻击', '木马病毒', '盗号',
];

/** 医疗类关键词 */
const MEDICAL_WORDS = [
  '生病', '疾病', '症状', '确诊', '吃什么药', '用药', '药物', '处方',
  '癌症', '肿瘤', '糖尿病', '高血压', '抑郁症', '失眠',
  '怎么治', '能治好吗', '治疗', '手术', '偏方', '诊断',
];

/** 法律类关键词 */
const LEGAL_WORDS = [
  '打官司', '起诉', '诉讼', '律师', '法律责任', '判几年', '量刑',
  '合同纠纷', '劳动仲裁', '离婚', '抚养权', '遗产', '继承',
  '违法吗', '犯法吗', '坐牢',
];

/** 投资理财类关键词 */
const INVESTMENT_WORDS = [
  '股票', '炒股', '基金', '买哪只', '涨跌', '牛市', '熊市',
  '理财', '收益率', '炒币', '比特币', '虚拟货币', '外汇',
  '投资建议', '会不会涨', '能赚多少', '荐股', '配资',
];

/** 转人工意图关键词 */
const HANDOFF_WORDS = [
  '转人工', '人工客服', '人工服务', '找人工', '要人工', '转客服',
  '真人', '找客服', '联系客服', '客服电话', '投诉电话',
  '转接', '叫个活人', '机器人别回', '答非所问',
];

/** 寒暄类词，用于剔除后判断是否纯问候 */
const SMALL_TALK_WORDS = [
  '你好', '您好', '您好呀', '哈喽', 'hello', 'hi', '在吗', '在么', '在不在',
  '早上好', '中午好', '下午好', '晚上好', '早安', '晚安',
  '谢谢', '谢谢你', '多谢', '感谢', '拜拜', '再见', '好的', '嗯嗯', '收到',
];

/**
 * 敏感词检测。
 * 直接做子串匹配，命中即拦截，并把命中的词返回用于日志（不返回给前端，避免教坏用户）。
 */
export function checkSensitive(text: string): { blocked: boolean; hits: string[] } {
  const normalized = text.toLowerCase();
  const hits = SENSITIVE_WORDS.filter((word) => normalized.includes(word.toLowerCase()));
  return { blocked: hits.length > 0, hits };
}

/** 风险领域类型 */
export type RiskyDomain = 'medical' | 'legal' | 'investment';

/**
 * 识别医疗 / 法律 / 投资类问题。
 * 这些领域不允许模型给专业结论，只会引导用户咨询专业人士或转人工。
 */
export function detectRiskyDomain(text: string): RiskyDomain | null {
  const normalized = text.toLowerCase();

  if (MEDICAL_WORDS.some((w) => normalized.includes(w))) return 'medical';
  if (LEGAL_WORDS.some((w) => normalized.includes(w))) return 'legal';
  if (INVESTMENT_WORDS.some((w) => normalized.includes(w))) return 'investment';

  return null;
}

/** 用户是否明确表达了「转人工」的诉求 */
export function detectHandoffIntent(text: string): boolean {
  const normalized = text.toLowerCase();
  return HANDOFF_WORDS.some((w) => normalized.includes(w));
}

/**
 * 是否只是纯寒暄（你好 / 谢谢 / 在吗）。
 *
 * 判断方式：把问候词和标点、空白全部剔除后，如果剩余内容不超过 2 个字，才算纯寒暄。
 * 这样「你好」→ 寒暄，「你好，我想问下退货政策」→ 不是寒暄，避免真实提问被误判。
 */
export function isSmallTalk(text: string): boolean {
  let rest = text.toLowerCase();

  for (const word of SMALL_TALK_WORDS) {
    rest = rest.split(word).join('');
  }
  // 去掉中英文标点、空白、语气词
  rest = rest.replace(/[\s，。！？、,.!?~～…—\-—呀啊呢吧哦噢额哈嗯]/g, '');

  return rest.length <= 2;
}

/**
 * 智能推荐话术 - 客户端工具栏
 *
 * 作用：
 *   1. 关键词匹配：扫最近 N 条用户消息，识别意图（退款/投诉/物流/优惠/发票/故障）
 *   2. 预置话术：每类意图对应多组候选话术（文本/图片/文件/卡片/富文本）
 *   3. 客户端 fallback：服务端 suggestion_chunk 推送之前的"秒级"占位
 *      （点开工具栏就能看到 1-2 条立刻可用的推荐，体感更快）
 *
 * 与 server/agent-ws.js 的 SUGGESTION_TEMPLATES 保持一致；
 * 服务端推送是权威源，客户端这版仅作为离线 / 弱网 fallback。
 */

import type { MessagePart } from '@/types/message';

export type SuggestionCategory = '退款' | '投诉' | '物流' | '优惠' | '发票' | '故障' | '通用';

interface CategoryRule {
  match: RegExp;
  category: SuggestionCategory;
}

const CATEGORY_RULES: CategoryRule[] = [
  { match: /退款|退钱|退货|refund/i, category: '退款' },
  { match: /投诉|举报|差评|工单/i, category: '投诉' },
  { match: /物流|快递|发货|到哪|单号/i, category: '物流' },
  { match: /优惠|折扣|券|促销|便宜/i, category: '优惠' },
  { match: /发票|收据|报销/i, category: '发票' },
  { match: /故障|坏了|用不了|错误|报错|bug/i, category: '故障' },
];

/**
 * 从消息列表中提取用户文本（合并最近 N 条），返回意图类别
 * 规则：按规则顺序匹配首个命中
 */
export function detectCategory(parts: Array<{ role: string; parts: MessagePart[] }>): SuggestionCategory {
  const recentUserText = parts
    .filter((m) => m.role === 'user')
    .slice(-3)
    .map((m) =>
      m.parts
        .filter((p) => p.type === 'text' || p.type === 'markdown')
        .map((p) => p.content)
        .join(' '),
    )
    .join(' ');
  for (const rule of CATEGORY_RULES) {
    if (rule.match.test(recentUserText)) return rule.category;
  }
  return '通用';
}

/** 话术模板（与 server SUGGESTION_TEMPLATES 对齐） */
interface SuggestionTemplate {
  preview: string;
  parts: MessagePart[];
}

const TEMPLATES: Record<SuggestionCategory, SuggestionTemplate[]> = {
  退款: [
    {
      preview: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。',
      parts: [{ type: 'text', content: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。' }],
    },
    {
      preview: '【图片】退款流程示意图 + 操作说明',
      parts: [
        {
          type: 'image',
          url: 'https://trae-api-cn.mchost.guru/api/ide/v1/text_to_image?prompt=Customer%20service%20refund%20flow%20infographic%2C%20flat%20design%2C%20Chinese%20e-commerce%20app%20style&image_size=landscape_4_3',
          alt: '退款流程示意图',
          caption: '退款操作流程',
        },
        { type: 'text', content: '请按上图操作，款项会在 1-3 个工作日内原路退回。' },
      ],
    },
  ],
  投诉: [
    {
      preview: '非常理解您的心情，我马上为您升级处理，专人跟进。',
      parts: [{ type: 'text', content: '非常理解您的心情，我马上为您升级处理，专人跟进。' }],
    },
    {
      preview: '【对比卡】补偿方案：20元券 / 10元现金 / 500积分',
      parts: [
        {
          type: 'comparison',
          title: '补偿方案',
          items: [
            { name: '20 元无门槛券', description: '即时到账', icon: '🎟️', highlight: true },
            { name: '现金 10 元', description: '原路退回', icon: '💰' },
            { name: '500 积分', description: '可换购商品', icon: '⭐' },
          ],
        },
      ],
    },
  ],
  物流: [
    {
      preview: '请提供一下订单号或快递单号，我帮您查询。',
      parts: [{ type: 'text', content: '请提供一下订单号或快递单号，我帮您查询。' }],
    },
  ],
  优惠: [
    {
      preview: '【文件】新客专享 50 元优惠券包',
      parts: [
        {
          type: 'file',
          name: '新客优惠券.pdf',
          size: 128000,
          url: 'https://example.com/coupon.pdf',
          mime: 'application/pdf',
        },
        { type: 'text', content: '这是为您申请的专属优惠券包，请查收～' },
      ],
    },
  ],
  发票: [
    {
      preview: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。',
      parts: [{ type: 'text', content: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。' }],
    },
  ],
  故障: [
    {
      preview: '【富文本】常见故障排查清单（4 步）',
      parts: [
        {
          type: 'rich',
          html: '<div style="background:#f7f8fa;padding:12px;border-radius:8px"><b>排查步骤：</b><ol><li>检查网络连接</li><li>重启 App</li><li>清除缓存</li><li>仍异常请截图反馈</li></ol></div>',
        },
      ],
    },
  ],
  通用: [
    {
      preview: '请问还有什么可以帮您的吗？',
      parts: [{ type: 'text', content: '请问还有什么可以帮您的吗？' }],
    },
  ],
};

/**
 * 客户端 fallback：拿到最近用户消息，立刻给一组推荐话术（不需要等服务端推送）
 */
export function getClientFallbackSuggestions(
  parts: Array<{ role: string; parts: MessagePart[] }>,
): Array<{ category: SuggestionCategory; templates: SuggestionTemplate[] }> {
  const cat = detectCategory(parts);
  const tpls = TEMPLATES[cat] || TEMPLATES['通用'];
  return [{ category: cat, templates: tpls }];
}

/** 提取 parts 的简短预览（用于推荐话术列表 hover 提示） */
export function extractPreview(parts: MessagePart[], fallback = ''): string {
  for (const p of parts) {
    if (p.type === 'text' || p.type === 'markdown') {
      return p.content.slice(0, 50);
    }
  }
  return fallback;
}

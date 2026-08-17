/**
 * 智能推荐话术 - 客户端工具栏（Vue 版 - 对齐 React 端）
 * 关键词匹配 + 预置话术模板 + 客户端 fallback
 */

import type { MessagePart } from '@/types/message';

export type SuggestionCategory = '退款' | '投诉' | '物流' | '优惠' | '发票' | '故障' | '通用';

const CATEGORY_RULES: Array<{ match: RegExp; category: SuggestionCategory }> = [
  { match: /退款|退钱|退货|refund/i, category: '退款' },
  { match: /投诉|举报|差评|工单/i, category: '投诉' },
  { match: /物流|快递|发货|到哪|单号/i, category: '物流' },
  { match: /优惠|折扣|券|促销|便宜/i, category: '优惠' },
  { match: /发票|收据|报销/i, category: '发票' },
  { match: /故障|坏了|用不了|错误|报错|bug/i, category: '故障' },
];

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

export interface FallbackTemplate {
  preview: string;
  parts: MessagePart[];
}

const TEMPLATES: Record<SuggestionCategory, FallbackTemplate[]> = {
  退款: [
    {
      preview: '亲，已收到您的退款申请，我帮您核实订单状态～',
      parts: [{ type: 'text', content: '亲，已收到您的退款申请，我帮您核实订单状态～' }],
    },
    {
      preview: '退款流程说明：订单页 → 申请退款 → 等待审核',
      parts: [
        {
          type: 'markdown',
          content: '**退款流程说明**\n\n1. 打开订单详情\n2. 点击「申请退款」\n3. 填写退款原因\n4. 等待客服审核（1-3 个工作日）',
        },
      ],
    },
  ],
  投诉: [
    {
      preview: '非常抱歉给您带来不好的体验，我马上为您升级处理。',
      parts: [
        {
          type: 'text',
          content: '非常抱歉给您带来不好的体验，我马上为您升级处理，请稍等片刻。',
        },
      ],
    },
    {
      preview: '补偿方案：优惠券 / 优先发货 / 专属客服',
      parts: [
        {
          type: 'comparison',
          title: '补偿方案',
          items: [
            { name: '5 元无门槛券', value: '即时', icon: '🎁' },
            { name: '优先发货', value: '24h 内', icon: '🚀' },
            { name: '专属客服', value: '1 对 1', icon: '👤' },
          ],
        },
      ],
    },
  ],
  物流: [
    {
      preview: '请提供您的订单号，我帮您查询物流信息。',
      parts: [{ type: 'text', content: '请提供您的订单号，我帮您查询物流信息。' }],
    },
    {
      preview: '常见物流时效（仅供参考）',
      parts: [
        {
          type: 'chart',
          chartType: 'bar',
          title: '各地区物流时效',
          data: {
            labels: ['一线城市', '二线城市', '三线城市', '偏远地区'],
            values: [1, 2, 3, 5],
            unit: '天',
          },
        },
      ],
    },
  ],
  优惠: [
    {
      preview: '目前新人首单立减 10 元，老用户可领 5 元无门槛券。',
      parts: [{ type: 'text', content: '目前新人首单立减 10 元，老用户可领 5 元无门槛券。' }],
    },
    {
      preview: '活动说明：双 11 限时优惠',
      parts: [
        {
          type: 'markdown',
          content: '## 限时优惠\n\n- 全场满 99 减 20\n- 第二件半价\n- 会员双倍积分\n\n> 活动截止 11.11 23:59',
        },
      ],
    },
  ],
  发票: [
    {
      preview: '电子发票将在订单完成后 1-3 个工作日开具。',
      parts: [{ type: 'text', content: '电子发票将在订单完成后 1-3 个工作日开具。' }],
    },
    {
      preview: '发票模板示例',
      parts: [
        {
          type: 'rich',
          html: '<div><b>发票类型：</b> 电子普通发票</div><div><b>抬头：</b> 个人</div>',
        },
      ],
    },
  ],
  故障: [
    {
      preview: '请尝试刷新页面或清除缓存，如仍未解决请提供截图。',
      parts: [{ type: 'text', content: '请尝试刷新页面或清除缓存，如仍未解决请提供截图。' }],
    },
    {
      preview: '故障排查清单',
      parts: [
        {
          type: 'task_list',
          title: '故障排查',
          tasks: [
            { label: '刷新页面', done: false },
            { label: '清除浏览器缓存', done: false },
            { label: '切换网络环境', done: false },
            { label: '提供错误截图', done: false },
          ],
        },
      ],
    },
  ],
  通用: [
    {
      preview: '您好，请问还有什么可以帮您？',
      parts: [{ type: 'text', content: '您好，请问还有什么可以帮您？' }],
    },
    {
      preview: '感谢您的耐心等待～',
      parts: [{ type: 'text', content: '感谢您的耐心等待～' }],
    },
  ],
};

export function getClientFallbackSuggestions(
  messages: Array<{ role: string; parts: MessagePart[] }>,
): Array<{ category: SuggestionCategory; templates: FallbackTemplate[] }> {
  const cat = detectCategory(messages);
  return [{ category: cat, templates: TEMPLATES[cat] }];
}

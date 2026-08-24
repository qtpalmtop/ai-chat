/**
 * Seed 脚本：把 mock 的话术模板写入 DB
 * - 启动后会自动被 SuggestionService.onModuleInit 加载
 * - 如果想强制刷新缓存，可以重启 NestJS 服务
 */
import 'reflect-metadata';
import * as path from 'path';
import * as dotenv from 'dotenv';
import dataSource from '../data-source';
import { SuggestionTemplateEntity } from '../../modules/suggestion/entities/suggestion-template.entity';

dotenv.config({ path: path.resolve(__dirname, '../../../.env') });

const SEEDS: Array<{ category: string; preview: string; parts: unknown[]; sortOrder: number }> = [
  {
    category: '退款',
    sortOrder: 0,
    preview: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。',
    parts: [
      { type: 'text', content: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。' },
    ],
  },
  {
    category: '退款',
    sortOrder: 1,
    preview: '【图片】退款流程示意图 + 文字说明',
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
  {
    category: '投诉',
    sortOrder: 0,
    preview: '非常理解您的心情，我马上为您升级处理，专人跟进。',
    parts: [
      { type: 'text', content: '非常理解您的心情，我马上为您升级处理，专人跟进。' },
    ],
  },
  {
    category: '投诉',
    sortOrder: 1,
    preview: '【卡片】补偿方案选择（优惠券/现金/积分）',
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
  {
    category: '物流',
    sortOrder: 0,
    preview: '请提供一下订单号或快递单号，我帮您查询。',
    parts: [{ type: 'text', content: '请提供一下订单号或快递单号，我帮您查询。' }],
  },
  {
    category: '优惠',
    sortOrder: 0,
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
  {
    category: '发票',
    sortOrder: 0,
    preview: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。',
    parts: [
      { type: 'text', content: '电子发票会在订单完成后 24 小时内开具，请提供邮箱。' },
    ],
  },
  {
    category: '故障',
    sortOrder: 0,
    preview: '【富文本】常见故障排查清单',
    parts: [
      {
        type: 'rich',
        html: '<div style="background:#f7f8fa;padding:12px;border-radius:8px"><b>排查步骤：</b><ol><li>检查网络连接</li><li>重启 App</li><li>清除缓存</li><li>仍异常请截图反馈</li></ol></div>',
      },
    ],
  },
  {
    category: '通用',
    sortOrder: 0,
    preview: '请问还有什么可以帮您的吗？',
    parts: [{ type: 'text', content: '请问还有什么可以帮您的吗？' }],
  },
];

async function main() {
  await dataSource.initialize();
  console.log('[seed] data source initialized');
  const repo = dataSource.getRepository(SuggestionTemplateEntity);
  // 先清空再插入（幂等）— TypeORM 不允许 delete({})，用 createQueryBuilder().delete()
  await repo.createQueryBuilder().delete().execute();
  for (const s of SEEDS) {
    await repo.save(repo.create(s));
  }
  console.log(`[seed] inserted ${SEEDS.length} suggestion templates`);
  await dataSource.destroy();
  console.log('[seed] done');
}

main().catch((err) => {
  console.error('[seed] failed', err);
  process.exit(1);
});

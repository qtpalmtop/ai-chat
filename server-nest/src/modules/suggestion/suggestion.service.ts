/**
 * Suggestion 服务：智能推荐话术
 * - 启动时把数据库里的 suggestion_templates 缓存到内存（按 category 分组）
 * - detectIntent(text)：关键词匹配 → category
 * - streamSuggestions(session)：流式推送一组话术给客服端
 *   真实生产应替换为 LLM；mock 阶段用关键词匹配
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SuggestionTemplateEntity } from './entities/suggestion-template.entity';
import {
  AgentMessageRecord,
} from '../../common/types/agent-protocol';
import { newId } from '../../common/utils/id.util';

const KEYWORD_RULES: Array<{ category: string; match: RegExp }> = [
  { category: '退款', match: /退款|退钱|退货|refund/i },
  { category: '投诉', match: /投诉|举报|差评|工单/i },
  { category: '物流', match: /物流|快递|发货|到哪|单号/i },
  { category: '优惠', match: /优惠|折扣|券|促销/i },
  { category: '发票', match: /发票|收据|报销/i },
  { category: '故障', match: /故障|坏了|用不了|错误/i },
];

/** mock 兜底模板（DB 没数据时用） */
const FALLBACK_TEMPLATES: Record<string, Array<{ preview: string; parts: unknown[] }>> = {
  退款: [
    {
      preview: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。',
      parts: [{ type: 'text', content: '亲，非常抱歉给您带来困扰～我先帮您核实一下订单情况。' }],
    },
    {
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
  ],
  通用: [
    {
      preview: '请问还有什么可以帮您的吗？',
      parts: [{ type: 'text', content: '请问还有什么可以帮您的吗？' }],
    },
  ],
};

@Injectable()
export class SuggestionService implements OnModuleInit {
  private readonly logger = new Logger(SuggestionService.name);
  private templatesByCategory: Map<string, Array<{ preview: string; parts: unknown[] }>> = new Map();

  constructor(
    @InjectRepository(SuggestionTemplateEntity)
    private readonly repo: Repository<SuggestionTemplateEntity>,
  ) {}

  async onModuleInit() {
    await this.refreshCache();
  }

  async refreshCache(): Promise<void> {
    const rows = await this.repo.find({ order: { sortOrder: 'ASC' } });
    const map = new Map<string, Array<{ preview: string; parts: unknown[] }>>();
    for (const r of rows) {
      const arr = map.get(r.category) ?? [];
      arr.push({ preview: r.preview, parts: r.parts });
      map.set(r.category, arr);
    }
    if (map.size === 0) {
      this.logger.warn('no suggestion_templates in DB, falling back to mock data');
      this.templatesByCategory = new Map(Object.entries(FALLBACK_TEMPLATES));
    } else {
      this.templatesByCategory = map;
    }
    this.logger.log(`loaded ${map.size} categories of suggestion templates`);
  }

  detectCategory(text: string): string {
    for (const rule of KEYWORD_RULES) {
      if (rule.match.test(text)) return rule.category;
    }
    return '通用';
  }

  getTemplates(category: string): Array<{ preview: string; parts: unknown[] }> {
    return (
      this.templatesByCategory.get(category) ??
      this.templatesByCategory.get('通用') ??
      FALLBACK_TEMPLATES['通用']
    );
  }

  /**
   * 流式推送一组话术：
   *   - 1.5s 延迟（mock 模拟"智能识别"）
   *   - 每 400ms 推一条 suggestion_chunk
   *   - 整组推完后把 accumulatedParts 写入 lastSuggestions 供 use_suggestion 取
   *
   * emitStart / emitChunk / emitDone 三个回调由 gateway 注入，避免 service 直接依赖 gateway
   */
  scheduleStream(
    sessionId: string,
    messages: AgentMessageRecord[],
    delayMs: number,
    callbacks: {
      start: (intentId: string, category: string) => void;
      chunk: (intentId: string, chunk: unknown[], done: boolean) => void;
      done: (intentId: string, parts: unknown[], category: string) => void;
      /** 校验会话是否仍然有效 */
      isValid: () => boolean;
    },
  ): void {
    setTimeout(() => {
      if (!callbacks.isValid()) return;
      const recentUserText = messages
        .filter((m) => m.role === 'user')
        .slice(-3)
        .map((m) =>
          m.parts
            .filter((p) => {
              const t = (p as { type?: string }).type;
              return t === 'text' || t === 'markdown';
            })
            .map((p) => (p as { content?: string }).content || '')
            .join(' '),
        )
        .join(' ');
      const category = this.detectCategory(recentUserText);
      const templates = this.getTemplates(category);
      const intentId = newId('intent');
      const accumulated: unknown[] = [];
      callbacks.start(intentId, category);

      templates.forEach((tpl, idx) => {
        setTimeout(() => {
          if (!callbacks.isValid()) return;
          for (const p of tpl.parts) accumulated.push(structuredClone(p));
          callbacks.chunk(intentId, tpl.parts, idx === templates.length - 1);
        }, 400 * (idx + 1));
      });

      // 整组推完后把 accumulated 写回
      setTimeout(() => {
        if (!callbacks.isValid()) return;
        callbacks.done(intentId, accumulated, category);
      }, 400 * templates.length + 50);
    }, delayMs);
  }
}

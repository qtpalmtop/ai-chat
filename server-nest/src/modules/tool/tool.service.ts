/**
 * 工具服务
 * - listEnabled：按 sortOrder 升序返回所有启用的工具
 * - findById
 * - seedIfEmpty：首次启动时塞入豆包 AI 助手（兜底）
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ToolEntity, ToolType } from './entities/tool.entity';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ToolService implements OnModuleInit {
  private readonly logger = new Logger(ToolService.name);

  constructor(
    @InjectRepository(ToolEntity)
    private readonly repo: Repository<ToolEntity>,
    private readonly config: ConfigService,
  ) {}

  async onModuleInit() {
    try {
      const count = await this.repo.count();
      if (count === 0) {
        await this.seedIfEmpty();
      }
    } catch (e) {
      this.logger.warn(`seed skipped: ${(e as Error).message}`);
    }
  }

  listEnabled(): Promise<ToolEntity[]> {
    return this.repo.find({
      where: { enabled: true },
      order: { sortOrder: 'ASC' },
    });
  }

  findById(id: string): Promise<ToolEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 首次启动 seed：插入豆包 AI 助手（webview 类型）
   * - url 只存路径 '/', 真正拼接在 controller 用当前 webview.baseUrl 完成
   * - 这样 dev/prod 切换环境时不用重新 seed
   */
  async seedIfEmpty(): Promise<void> {
    const tools: Array<Partial<ToolEntity>> = [
      {
        id: 'doubao-ai',
        name: '豆包 AI 助手',
        description: '与豆包 AI 助手对话',
        icon: '🤖',
        type: 'webview' as ToolType,
        url: '/', // 路径，不含 host，由 controller 动态拼
        deeplink: null,
        sortOrder: 10,
        enabled: true,
        tags: ['ai', 'chat'],
      },
    ];
    await this.repo.save(tools);
    this.logger.log(`seeded ${tools.length} tool(s)`);
  }
}

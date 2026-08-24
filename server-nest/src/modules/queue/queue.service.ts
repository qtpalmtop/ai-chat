/**
 * Queue 服务：排队管理
 * - add / remove / list（按 queuedAt 升序）
 * - 注意：DB 里 clientId 唯一索引（已经在 Entity 里声明），
 *   add 时如果已存在则忽略（兼容重连场景）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueueEntryEntity, QueueReason } from './entities/queue-entry.entity';
import { QueueItem } from '../../common/types/agent-protocol';

@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);

  constructor(
    @InjectRepository(QueueEntryEntity)
    private readonly repo: Repository<QueueEntryEntity>,
  ) {}

  async add(input: {
    clientId: string;
    userName?: string;
    userAvatar?: string;
    reason?: QueueReason;
    lastUserMessage?: string;
  }): Promise<void> {
    const existing = await this.repo.findOne({ where: { clientId: input.clientId } });
    if (existing) {
      // 已存在：刷新字段，不重新入队
      existing.userName = input.userName ?? existing.userName;
      existing.userAvatar = input.userAvatar ?? existing.userAvatar;
      existing.reason = input.reason ?? existing.reason;
      existing.lastUserMessage = input.lastUserMessage ?? existing.lastUserMessage;
      await this.repo.save(existing);
      return;
    }
    await this.repo.save(
      this.repo.create({
        clientId: input.clientId,
        userName: input.userName ?? null,
        userAvatar: input.userAvatar ?? null,
        reason: input.reason ?? 'normal',
        queuedAt: Date.now(),
        lastUserMessage: input.lastUserMessage ?? null,
      }),
    );
    this.logger.log(`queue add: clientId=${input.clientId}`);
  }

  async remove(clientId: string): Promise<boolean> {
    const res = await this.repo.delete({ clientId });
    return (res.affected ?? 0) > 0;
  }

  async list(): Promise<QueueItem[]> {
    const rows = await this.repo.find({ order: { queuedAt: 'ASC' } });
    return rows.map((r) => ({
      clientId: r.clientId,
      userName: r.userName ?? undefined,
      userAvatar: r.userAvatar ?? undefined,
      queuedAt: Number(r.queuedAt),
      reason: r.reason,
      lastUserMessage: r.lastUserMessage ?? undefined,
    }));
  }

  count(): Promise<number> {
    return this.repo.count();
  }

  positionOf(clientId: string): Promise<number> {
    return this.repo
      .find({ order: { queuedAt: 'ASC' } })
      .then((rows) => {
        const idx = rows.findIndex((r) => r.clientId === clientId);
        return idx === -1 ? -1 : idx + 1;
      });
  }
}

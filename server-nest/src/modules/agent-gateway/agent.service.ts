/**
 * Agent 服务：管理客服档案 + 在线状态
 * - upsert: 连接时调用
 * - markOnline / markOffline: gateway 在 connect/disconnect 时调用
 * - heartbeat: 客服端心跳（25s）时更新 lastHeartbeatAt
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgentEntity } from './entities/agent.entity';

@Injectable()
export class AgentService {
  private readonly logger = new Logger(AgentService.name);

  constructor(
    @InjectRepository(AgentEntity)
    private readonly repo: Repository<AgentEntity>,
  ) {}

  async ensure(id: string, name?: string, avatar?: string): Promise<AgentEntity> {
    // 用 ON CONFLICT DO NOTHING 幂等 upsert，避免 handleConnection + agent.hello 并发冲突
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(AgentEntity)
      .values({
        id,
        name: name ?? null,
        avatar: avatar ?? null,
        isOnline: false,
      })
      .orIgnore()
      .execute();
    if (name || avatar) {
      const update: Partial<AgentEntity> = {};
      if (name) update.name = name;
      if (avatar) update.avatar = avatar;
      const res = await this.repo.update({ id }, update);
      if (res.affected && res.affected > 0) {
        this.logger.log(`agent upsert: update id=${id} name=${name}`);
      }
    }
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new Error(`agent ensure failed: row not found after upsert id=${id}`);
    }
    if (!name && !avatar) {
      this.logger.log(`agent upsert: new id=${id}`);
    }
    return row;
  }

  async markOnline(id: string): Promise<void> {
    await this.repo.update({ id }, { isOnline: true, lastHeartbeatAt: Date.now() });
  }

  async markOffline(id: string): Promise<void> {
    await this.repo.update({ id }, { isOnline: false, lastHeartbeatAt: Date.now() });
  }

  async heartbeat(id: string): Promise<void> {
    await this.repo.update({ id }, { lastHeartbeatAt: Date.now() });
  }

  countOnline(): Promise<number> {
    return this.repo.count({ where: { isOnline: true } });
  }
}

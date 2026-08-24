/**
 * Client 服务：管理用户档案
 * - upsert：连接时调用，不存在则创建
 * - 缓存常用字段（name, avatar）以减少 DB 查询
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ClientEntity } from './entities/client.entity';

@Injectable()
export class ClientService {
  private readonly logger = new Logger(ClientService.name);

  constructor(
    @InjectRepository(ClientEntity)
    private readonly repo: Repository<ClientEntity>,
  ) {}

  /** 上线/首次连接时调用：保证 DB 里有一条记录
   *  用 PostgreSQL 原生 ON CONFLICT 幂等 upsert，避免并发 ensure 时的 race condition
   *  （handleConnection 与 client.hello 会同时调一次，findOne + insert 会冲突）
   */
  async ensure(
    id: string,
    name?: string,
    avatar?: string,
  ): Promise<ClientEntity> {
    // 1) 用 ON CONFLICT DO NOTHING 幂等写入
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(ClientEntity)
      .values({ id, name: name ?? null, avatar: avatar ?? null })
      .orIgnore()
      .execute();

    // 2) 如果有 name/avatar 需要更新，走 partial update
    if (name || avatar) {
      const update: Partial<ClientEntity> = {};
      if (name) update.name = name;
      if (avatar) update.avatar = avatar;
      const res = await this.repo.update({ id }, update);
      if (res.affected && res.affected > 0) {
        this.logger.log(`client upsert: update id=${id} name=${name}`);
      }
    }
    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      // 不应该发生，ON CONFLICT DO NOTHING 后一定能查到
      throw new Error(`client ensure failed: row not found after upsert id=${id}`);
    }
    if (!name && !avatar) {
      this.logger.log(`client upsert: new id=${id}`);
    }
    return row;
  }

  findById(id: string) {
    return this.repo.findOne({ where: { id } });
  }
}

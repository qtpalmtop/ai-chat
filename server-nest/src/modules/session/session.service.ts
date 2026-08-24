/**
 * Session 服务：会话 + 消息的持久化
 * - 创建会话（客服接单时）
 * - 追加消息（用户/客服发消息时）
 * - 结束会话（同步标记 status=ended + 推 history）
 * - 列出/读取消息（断线重连场景）
 * - 找活跃会话（按 clientId）
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, MoreThan, Repository } from 'typeorm';
import { SessionEntity, SessionStatus } from './entities/session.entity';
import { MessageEntity, MessageRole } from './entities/message.entity';
import {
  AgentMessageRecord,
  HistoryEndReason,
} from '../../common/types/agent-protocol';
import { newId } from '../../common/utils/id.util';

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @InjectRepository(SessionEntity)
    private readonly sessionRepo: Repository<SessionEntity>,
    @InjectRepository(MessageEntity)
    private readonly messageRepo: Repository<MessageEntity>,
    private readonly dataSource: DataSource,
  ) {}

  async create(input: {
    clientId: string;
    agentId: string;
    userName?: string;
    agentName?: string;
  }): Promise<SessionEntity> {
    const sess = this.sessionRepo.create({
      id: newId('sess'),
      clientId: input.clientId,
      agentId: input.agentId,
      status: 'inSession' as SessionStatus,
      userName: input.userName ?? null,
      agentName: input.agentName ?? null,
      userHasSpoken: false,
      startedAt: Date.now(),
      endedAt: null,
      endReason: null,
    });
    await this.sessionRepo.save(sess);
    this.logger.log(`session create: ${sess.id} client=${input.clientId} agent=${input.agentId}`);
    return sess;
  }

  async findById(id: string): Promise<SessionEntity | null> {
    return this.sessionRepo.findOne({ where: { id } });
  }

  async findActiveByClient(clientId: string): Promise<SessionEntity | null> {
    return this.sessionRepo.findOne({
      where: { clientId, status: 'inSession' as SessionStatus },
    });
  }

  /**
   * 列出某客服负责的所有活跃会话（用于客服端重连时一次性补齐 activeSessions）
   * - 不传 agentId 时返回所有 inSession 会话（兜底，正常不会用）
   * - 主要场景：客服断线重连 → 推 session_restored 给客服端 → 客服端 UI 能恢复所有 inSession 会话
   */
  async listActiveByAgent(agentId: string): Promise<SessionEntity[]> {
    return this.sessionRepo.find({
      where: { agentId, status: 'inSession' as SessionStatus },
      order: { startedAt: 'ASC' },
    });
  }

  /**
   * 列出会话内消息（按 createdAt 升序）
   * @param sessionId 会话 id
   * @param since 增量同步起点：只返回 createdAt > since 的消息
   *              - undefined：全量（用于 session_restored 一次性补齐）
   *              - 数字：增量（断线重连后客户端用"最后一条 createdAt"拉差量）
   *
   * 注意：since 用严格大于（MoreThan）——边界消息由客户端已有的保留，避免重复。
   * 如果客户端有"最后一条 createdAt = 1700000000000"，传 since=1700000000000，
   * 服务端返回 createdAt > 1700000000000 的所有消息，客户端 mergeMessagesById 去重。
   */
  async listMessages(
    sessionId: string,
    since?: number,
  ): Promise<AgentMessageRecord[]> {
    const where: Record<string, unknown> = { sessionId };
    if (typeof since === 'number' && Number.isFinite(since)) {
      where.createdAt = MoreThan(since);
    }
    const rows = await this.messageRepo.find({
      where: where as { sessionId: string },
      order: { createdAt: 'ASC' },
    });
    return rows.map((r) => ({
      id: r.id,
      sessionId: r.sessionId,
      role: r.role as MessageRole,
      parts: r.parts as unknown[],
      status: r.status,
      createdAt: Number(r.createdAt),
    }));
  }

  async appendMessage(input: {
    sessionId: string;
    role: MessageRole;
    parts: unknown[];
    messageId?: string;
  }): Promise<AgentMessageRecord> {
    const msg = this.messageRepo.create({
      id: input.messageId || newId('msg'),
      sessionId: input.sessionId,
      role: input.role,
      parts: input.parts,
      status: 'done',
      createdAt: Date.now(),
    });
    await this.messageRepo.save(msg);
    return {
      id: msg.id,
      sessionId: msg.sessionId,
      role: msg.role as MessageRole,
      parts: msg.parts as unknown[],
      status: msg.status,
      createdAt: Number(msg.createdAt),
    };
  }

  async markUserHasSpoken(sessionId: string): Promise<void> {
    await this.sessionRepo.update({ id: sessionId }, { userHasSpoken: true });
  }

  /** 结束会话：原子事务里同时更新 sessions + 删除活跃索引（DB 内不删，留作审计） */
  async endSession(
    sessionId: string,
    reason: HistoryEndReason,
  ): Promise<SessionEntity | null> {
    return this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(SessionEntity);
      const sess = await repo.findOne({ where: { id: sessionId } });
      if (!sess) return null;
      if (sess.status === 'ended') return sess; // 幂等
      sess.status = 'ended';
      sess.endedAt = Date.now();
      sess.endReason = reason;
      await repo.save(sess);
      return sess;
    });
  }
}

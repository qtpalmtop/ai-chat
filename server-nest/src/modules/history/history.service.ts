/**
 * History 服务：历史会话管理
 * - append：endSession 时把会话快照写入 history_sessions
 * - listForAgent / listForClient：列出某一方参与过的历史
 * - findOne：查某条历史详情
 * - prune：清理过期或超过上限的条目
 */
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { HistorySessionEntity } from './entities/history-session.entity';
import {
  AgentMessageRecord,
  HistoryEndReason,
  HistorySessionDetail,
  HistorySessionItem,
} from '../../common/types/agent-protocol';

@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);

  constructor(
    @InjectRepository(HistorySessionEntity)
    private readonly repo: Repository<HistorySessionEntity>,
    private readonly config: ConfigService,
  ) {}

  /**
   * 把会话快照写入 history_sessions
   * - 深拷贝 messages，避免被后续操作影响
   * - 冗余写入 lastUserMessage / lastAgentMessage / messageCount，方便列表展示
   */
  async append(input: {
    sessionId: string;
    clientId: string;
    agentId: string;
    userName?: string;
    agentName?: string;
    startedAt: number;
    endedAt: number;
    endReason: HistoryEndReason;
    messages: AgentMessageRecord[];
  }): Promise<HistorySessionEntity> {
    const extractText = (m?: AgentMessageRecord) => {
      if (!m) return null;
      return m.parts
        .filter((p) => {
          const t = (p as { type?: string }).type;
          return t === 'text' || t === 'markdown';
        })
        .map((p) => (p as { content?: string }).content || '')
        .join(' ')
        .slice(0, 80);
    };
    const lastUser = [...input.messages].reverse().find((m) => m.role === 'user');
    const lastAgent = [...input.messages].reverse().find((m) => m.role === 'agent');

    const row = this.repo.create({
      sessionId: input.sessionId,
      clientId: input.clientId,
      agentId: input.agentId,
      userName: input.userName ?? null,
      agentName: input.agentName ?? null,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      endReason: input.endReason,
      messages: input.messages.map((m) => ({ ...m, parts: [...m.parts] })),
      messageCount: input.messages.length,
      lastUserMessage: extractText(lastUser),
      lastAgentMessage: extractText(lastAgent),
    });
    await this.repo.save(row);
    this.logger.log(`history append: ${input.sessionId} (${input.messages.length} msgs)`);
    return row;
  }

  async findOne(sessionId: string): Promise<HistorySessionDetail | null> {
    const row = await this.repo.findOne({ where: { sessionId } });
    if (!row) return null;
    return this.toDetail(row);
  }

  async listForAgent(agentId: string): Promise<HistorySessionItem[]> {
    const rows = await this.repo.find({
      where: { agentId },
      order: { endedAt: 'DESC' },
    });
    return rows.map((r) => this.toItem(r));
  }

  async listForClient(clientId: string): Promise<HistorySessionItem[]> {
    const rows = await this.repo.find({
      where: { clientId },
      order: { endedAt: 'DESC' },
    });
    return rows.map((r) => this.toItem(r));
  }

  /**
   * 清理：
   *   - 移除 endedAt < cutoff 的过期记录
   *   - 单方超出 HISTORY_MAX_PER_AGENT 时按 endedAt 删最老的
   */
  async prune(scope: { agentId?: string; clientId?: string }): Promise<number> {
    const retention = this.config.get<number>('business.historyRetentionMs')!;
    const max = this.config.get<number>('business.historyMaxPerAgent')!;
    const cutoff = Date.now() - retention;

    // 1) 删过期
    const expired = await this.repo.delete({
      ...scope,
      endedAt: LessThan(cutoff),
    });

    // 2) 删超量
    let overLimit = 0;
    if (scope.agentId) {
      overLimit += await this.pruneOverLimit(scope.agentId, max);
    }
    if (scope.clientId) {
      overLimit += await this.pruneOverLimit(undefined, max, scope.clientId);
    }
    return (expired.affected ?? 0) + overLimit;
  }

  private async pruneOverLimit(
    agentId?: string,
    max = 200,
    clientId?: string,
  ): Promise<number> {
    const where: Record<string, unknown> = {};
    if (agentId) where.agentId = agentId;
    if (clientId) where.clientId = clientId;
    const all = await this.repo.find({ where, order: { endedAt: 'DESC' } });
    if (all.length <= max) return 0;
    const toDelete = all.slice(max);
    const ids = toDelete.map((r) => r.sessionId);
    const res = await this.repo.delete(ids);
    return res.affected ?? 0;
  }

  private toItem(r: HistorySessionEntity): HistorySessionItem {
    return {
      sessionId: r.sessionId,
      clientId: r.clientId,
      userName: r.userName ?? undefined,
      agentId: r.agentId,
      agentName: r.agentName ?? undefined,
      startedAt: Number(r.startedAt),
      endedAt: Number(r.endedAt),
      endReason: r.endReason,
      messageCount: r.messageCount,
      lastUserMessage: r.lastUserMessage ?? undefined,
      lastAgentMessage: r.lastAgentMessage ?? undefined,
    };
  }

  private toDetail(r: HistorySessionEntity): HistorySessionDetail {
    return {
      sessionId: r.sessionId,
      clientId: r.clientId,
      userName: r.userName ?? undefined,
      agentId: r.agentId,
      agentName: r.agentName ?? undefined,
      startedAt: Number(r.startedAt),
      endedAt: Number(r.endedAt),
      endReason: r.endReason,
      messages: (r.messages as AgentMessageRecord[]) ?? [],
    };
  }
}

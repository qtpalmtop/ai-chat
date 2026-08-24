/**
 * 历史会话（endSession 后转存的快照）
 * - 用 lastUserMessage / lastAgentMessage 字段冗余存储列表预览，避免每次都 join messages 表
 * - 完整 messages 存 JSONB，sessionId 全局唯一
 *
 * 索引策略：
 *   - (agentId, endedAt DESC)：客服端列表查"我处理过的所有历史"
 *   - (clientId, endedAt DESC)：客户端查"我参与过的所有历史"
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type HistoryEndReason = 'user' | 'agent' | 'timeout' | 'error';

@Entity('history_sessions')
@Index(['agentId', 'endedAt'])
@Index(['clientId', 'endedAt'])
export class HistorySessionEntity {
  @PrimaryColumn({ type: 'varchar', length: 96 })
  sessionId!: string;

  @Column({ type: 'varchar', length: 64 })
  clientId!: string;

  @Column({ type: 'varchar', length: 64 })
  agentId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  userName!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  agentName!: string | null;

  @Column({ type: 'bigint' })
  startedAt!: number;

  @Column({ type: 'bigint' })
  endedAt!: number;

  @Column({ type: 'varchar', length: 32 })
  endReason!: HistoryEndReason;

  @Column({ type: 'jsonb' })
  messages!: unknown[];

  @Column({ type: 'int', default: 0 })
  messageCount!: number;

  @Column({ type: 'text', nullable: true })
  lastUserMessage!: string | null;

  @Column({ type: 'text', nullable: true })
  lastAgentMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

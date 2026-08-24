/**
 * 客服 ↔ 用户的活跃会话
 * - 状态机：inSession → ended
 * - 一旦 ended，行不删（供 history_sessions 追溯），但会从活跃索引移除
 * - userHasSpoken：只有用户发过消息后，30s 静默才自动结束；避免"用户刚转人工还在打字就被结束"
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type SessionStatus = 'inSession' | 'ended';

@Entity('sessions')
@Index(['clientId', 'status'])
@Index(['agentId', 'status'])
export class SessionEntity {
  @PrimaryColumn({ type: 'varchar', length: 96 })
  id!: string;

  @Column({ type: 'varchar', length: 64 })
  clientId!: string;

  @Column({ type: 'varchar', length: 64 })
  agentId!: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'inSession' })
  status!: SessionStatus;

  /** 缓存的用户名（队列里来的，断了重连也能用） */
  @Column({ type: 'varchar', length: 128, nullable: true })
  userName!: string | null;

  /** 缓存的客服名 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  agentName!: string | null;

  /** 用户活跃度判定：只有 true 后，30s 静默才自动结束 */
  @Column({ type: 'boolean', default: false })
  userHasSpoken!: boolean;

  @Column({ type: 'bigint' })
  startedAt!: number;

  @Column({ type: 'bigint', nullable: true })
  endedAt!: number | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  endReason!: string | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

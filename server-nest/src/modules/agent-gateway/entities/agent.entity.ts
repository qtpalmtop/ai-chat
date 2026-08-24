/**
 * 客服实体
 * - 客服在 WebSocket 连接时不需要"登录"，靠 query id 自报身份
 * - 但需要在 DB 里持久化客服档案（头像、历史会话等关联都靠 agentId）
 * - 不存在时由 AgentService.ensureAgent() 自动 upsert
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('agents')
export class AgentEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  name!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  avatar!: string | null;

  /** 当前是否在线（最近 N 秒有 heartbeat） */
  @Index()
  @Column({ type: 'boolean', default: false })
  isOnline!: boolean;

  /** 上次 heartbeat 时间戳 */
  @Column({ type: 'bigint', nullable: true })
  lastHeartbeatAt!: number | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

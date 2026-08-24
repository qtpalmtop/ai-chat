/**
 * 排队记录
 * - 简化：同一 clientId 只能有一条 in-queue 记录
 * - lastUserMessage 供客服端快速判断优先级
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type QueueReason = 'normal' | 'vip' | 'after_hours' | 'all_busy';

@Entity('queue_entries')
@Index(['clientId'], { unique: true })
export class QueueEntryEntity {
  @PrimaryGeneratedColumn('uuid')
  pk!: string;

  @Column({ type: 'varchar', length: 64 })
  clientId!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  userName!: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  userAvatar!: string | null;

  @Column({ type: 'bigint' })
  queuedAt!: number;

  @Column({ type: 'varchar', length: 32, default: 'normal' })
  reason!: QueueReason;

  @Column({ type: 'text', nullable: true })
  lastUserMessage!: string | null;

  @CreateDateColumn()
  createdAt!: Date;
}

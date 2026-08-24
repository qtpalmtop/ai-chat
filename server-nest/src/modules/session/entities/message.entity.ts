/**
 * 会话内的消息
 * - parts 存 JSONB（PostgreSQL 原生 JSON 列）
 * - 跟前端 MessagePart 类型完全一致
 * - role: user / agent（assistant / system 不在客服会话里出现）
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from 'typeorm';

export type MessageRole = 'user' | 'agent';

@Entity('messages')
@Index(['sessionId', 'createdAt'])
export class MessageEntity {
  @PrimaryColumn({ type: 'varchar', length: 96 })
  id!: string;

  @Column({ type: 'varchar', length: 96 })
  sessionId!: string;

  @Column({ type: 'varchar', length: 16 })
  role!: MessageRole;

  @Column({ type: 'jsonb' })
  parts!: unknown[];

  @Column({ type: 'varchar', length: 16, default: 'done' })
  status!: string;

  @Column({ type: 'bigint' })
  createdAt!: number;

  @CreateDateColumn()
  insertedAt!: Date;
}

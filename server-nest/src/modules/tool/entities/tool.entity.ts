/**
 * 工具实体（AI 工具箱 App 的工具元数据）
 * - id：业务 id（如 'doubao-ai'）
 * - name / description / icon：前端展示
 * - type：'webview' | 'deeplink' | 'native'
 * - url / deeplink：具体地址
 * - sortOrder：升序
 * - enabled：是否启用
 * - tags：用于筛选
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

export type ToolType = 'webview' | 'deeplink' | 'native';

@Entity('tools')
export class ToolEntity {
  @PrimaryColumn({ type: 'varchar', length: 64 })
  id!: string;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'varchar', length: 512, nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 256, default: '🛠️' })
  icon!: string;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'webview' })
  type!: ToolType;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  url!: string | null;

  @Column({ type: 'varchar', length: 1024, nullable: true })
  deeplink!: string | null;

  @Index()
  @Column({ type: 'int', default: 100 })
  sortOrder!: number;

  @Index()
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ type: 'text', array: true, nullable: true })
  tags!: string[] | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

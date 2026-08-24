/**
 * 智能推荐话术模板
 * - 预置多组（category 分组），mock 阶段用关键词匹配；真实接 LLM 时可换成"category → templates"双层查表
 * - parts 存 JSONB：复用前端的 MessagePart 联合类型
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('suggestion_templates')
@Index(['category', 'sortOrder'])
export class SuggestionTemplateEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 32 })
  category!: string;

  @Column({ type: 'text' })
  preview!: string;

  @Column({ type: 'jsonb' })
  parts!: unknown[];

  @Column({ type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn()
  createdAt!: Date;
}

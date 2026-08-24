/**
 * 设备实体（App 端注册）
 * - id：expo push token 派生（也可用 UUID）；同一 token 多次注册幂等
 * - platform：ios | android
 * - appVersion / model / osVersion / timezone / locale：基础设备信息
 * - pushToken：expo push token
 * - lastLatitude / lastLongitude：最近一次主动上报的位置
 * - lastSeenAt：最近活跃时间
 * - userId（可选）：登录态关联（当前阶段不用，留扩展位）
 */
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('devices')
export class DeviceEntity {
  @PrimaryColumn({ type: 'varchar', length: 128 })
  id!: string;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  platform!: 'ios' | 'android';

  @Column({ type: 'varchar', length: 32, default: '0.0.0' })
  appVersion!: string;

  @Column({ type: 'varchar', length: 128, nullable: true })
  model!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  osVersion!: string | null;

  @Column({ type: 'varchar', length: 256, nullable: true })
  pushToken!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  timezone!: string | null;

  @Column({ type: 'varchar', length: 16, nullable: true })
  locale!: string | null;

  @Column({ type: 'double precision', nullable: true })
  lastLatitude!: number | null;

  @Column({ type: 'double precision', nullable: true })
  lastLongitude!: number | null;

  @Index()
  @Column({ type: 'timestamptz', nullable: true })
  lastSeenAt!: Date | null;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}

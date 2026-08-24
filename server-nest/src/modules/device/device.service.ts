/**
 * 设备服务
 * - ensure：用 pushToken 派生 id（无 pushToken 时用 randomUUID），幂等 upsert
 * - reportLocation：单独的位置上报
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomUUID, createHash } from 'node:crypto';
import { DeviceEntity } from './entities/device.entity';

export interface RegisterDeviceInput {
  pushToken?: string;
  platform: 'ios' | 'android';
  appVersion: string;
  model?: string;
  osVersion?: string;
  timezone?: string;
  locale?: string;
  location?: { latitude: number; longitude: number };
}

@Injectable()
export class DeviceService {
  private readonly logger = new Logger(DeviceService.name);

  constructor(
    @InjectRepository(DeviceEntity)
    private readonly repo: Repository<DeviceEntity>,
  ) {}

  /**
   * 幂等 upsert
   * - id 派生：有 pushToken → sha256(pushToken).slice(0, 32)；无 → randomUUID
   * - 用 ON CONFLICT DO NOTHING + 局部 update 避免 race
   */
  async ensure(input: RegisterDeviceInput): Promise<DeviceEntity> {
    const id = this.deriveId(input.pushToken);

    // 1) 幂等插入
    await this.repo
      .createQueryBuilder()
      .insert()
      .into(DeviceEntity)
      .values({
        id,
        platform: input.platform,
        appVersion: input.appVersion,
        model: input.model ?? null,
        osVersion: input.osVersion ?? null,
        pushToken: input.pushToken ?? null,
        timezone: input.timezone ?? null,
        locale: input.locale ?? null,
        lastLatitude: input.location?.latitude ?? null,
        lastLongitude: input.location?.longitude ?? null,
        lastSeenAt: new Date(),
      })
      .orIgnore()
      .execute();

    // 2) 更新设备信息（pushToken 可能变化、版本变化、位置变化）
    const update: Partial<DeviceEntity> = {
      lastSeenAt: new Date(),
    };
    if (input.pushToken) update.pushToken = input.pushToken;
    if (input.model) update.model = input.model;
    if (input.osVersion) update.osVersion = input.osVersion;
    if (input.appVersion) update.appVersion = input.appVersion;
    if (input.timezone) update.timezone = input.timezone;
    if (input.locale) update.locale = input.locale;
    if (input.location) {
      update.lastLatitude = input.location.latitude;
      update.lastLongitude = input.location.longitude;
    }
    const res = await this.repo.update({ id }, update);
    if (res.affected && res.affected > 0) {
      this.logger.log(`device upsert update id=${id} platform=${input.platform}`);
    } else {
      this.logger.log(`device upsert new id=${id} platform=${input.platform}`);
    }

    const row = await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new Error(`device ensure failed: row not found after upsert id=${id}`);
    }
    return row;
  }

  async reportLocation(
    id: string,
    location: { latitude: number; longitude: number },
  ): Promise<void> {
    await this.repo.update(
      { id },
      {
        lastLatitude: location.latitude,
        lastLongitude: location.longitude,
        lastSeenAt: new Date(),
      },
    );
  }

  findById(id: string): Promise<DeviceEntity | null> {
    return this.repo.findOne({ where: { id } });
  }

  /**
   * 设备 id 派生规则
   * - 有 pushToken：sha256(pushToken).slice(0, 32) —— 同一台设备 token 不变，id 稳定
   * - 无 pushToken（用户拒绝推送）：randomUUID —— 每次启动一个新 id，没关系，注册表本来就会冷启
   */
  private deriveId(pushToken?: string): string {
    if (pushToken && pushToken.length > 0) {
      return createHash('sha256').update(pushToken).digest('hex').slice(0, 32);
    }
    return randomUUID();
  }
}

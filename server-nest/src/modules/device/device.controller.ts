/**
 * 设备 REST 控制器
 * - POST /api/devices           注册/更新设备
 * - POST /api/devices/location  上报位置
 */
import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeviceService, RegisterDeviceInput } from './device.service';
import { ToolService } from '../tool/tool.service';
import { ToolEntity } from '../tool/entities/tool.entity';
import { resolveToolUrl } from '../tool/tool.util';

function toolToDto(t: ToolEntity, baseUrl: string) {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    type: t.type,
    url: resolveToolUrl(t.url, baseUrl),
    deeplink: t.deeplink,
    sortOrder: t.sortOrder,
    enabled: t.enabled,
    tags: t.tags ?? [],
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

interface RegisterBody {
  pushToken?: string;
  platform?: string;
  appVersion?: string;
  model?: string;
  osVersion?: string;
  timezone?: string;
  locale?: string;
  location?: { latitude: number; longitude: number };
}

@Controller('api')
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly tools: ToolService,
    private readonly config: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.config.get<string>('webview.baseUrl') || 'http://localhost:3001/';
  }

  /**
   * 注册设备
   * Body: { pushToken?, platform, appVersion, model?, osVersion?, timezone?, locale?, location? }
   * Response: { deviceId, tools, webviewBaseUrl }
   */
  @Post('devices')
  @HttpCode(200)
  async register(@Body() body: RegisterBody) {
    if (!body || !body.platform) {
      throw new BadRequestException('platform is required');
    }
    if (body.platform !== 'ios' && body.platform !== 'android') {
      throw new BadRequestException(`invalid platform: ${body.platform}`);
    }
    const input: RegisterDeviceInput = {
      pushToken: body.pushToken,
      platform: body.platform,
      appVersion: body.appVersion || '0.0.0',
      model: body.model,
      osVersion: body.osVersion,
      timezone: body.timezone,
      locale: body.locale,
      location: body.location,
    };
    const device = await this.devices.ensure(input);
    const toolList = await this.tools.listEnabled();
    return {
      deviceId: device.id,
      tools: toolList.map((t) => toolToDto(t, this.baseUrl)),
      webviewBaseUrl: this.baseUrl,
    };
  }

  /**
   * 上报位置（需带 X-Device-Id header）
   */
  @Post('devices/location')
  @HttpCode(200)
  async reportLocation(
    @Headers('x-device-id') deviceId: string | undefined,
    @Body() body: { latitude?: number; longitude?: number },
  ) {
    if (!deviceId) {
      throw new BadRequestException('X-Device-Id header is required');
    }
    if (typeof body?.latitude !== 'number' || typeof body?.longitude !== 'number') {
      throw new BadRequestException('latitude and longitude are required');
    }
    const dev = await this.devices.findById(deviceId);
    if (!dev) throw new NotFoundException(`device not found: ${deviceId}`);
    await this.devices.reportLocation(deviceId, {
      latitude: body.latitude,
      longitude: body.longitude,
    });
    return { ok: true };
  }
}

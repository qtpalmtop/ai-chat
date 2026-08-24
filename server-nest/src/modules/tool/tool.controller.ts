/**
 * 工具 REST 控制器
 * - GET /api/tools           列表
 * - GET /api/tools/:id       详情
 * - GET /api/tools-config    客户端可拉取的运行时配置（webviewBaseUrl 等）
 *
 * URL 解析（详见 tool.util.ts）：
 *  - tool.url 是相对路径，响应时按当前 webview.baseUrl 拼成完整 URL
 *  - dev/prod 切换地址不用重新 seed
 *  - 外站完整 URL 保留 host
 */
import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ToolService } from './tool.service';
import { ToolEntity } from './entities/tool.entity';
import { resolveToolUrl } from './tool.util';

function toDto(t: ToolEntity, baseUrl: string) {
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

@Controller('api')
export class ToolController {
  constructor(
    private readonly tools: ToolService,
    private readonly cfg: ConfigService,
  ) {}

  private get baseUrl(): string {
    return this.cfg.get<string>('webview.baseUrl') || 'http://localhost:3001/';
  }

  @Get('tools')
  async list() {
    const list = await this.tools.listEnabled();
    return list.map((t) => toDto(t, this.baseUrl));
  }

  @Get('tools/:id')
  async detail(@Param('id') id: string) {
    const t = await this.tools.findById(id);
    if (!t) throw new NotFoundException(`tool not found: ${id}`);
    return toDto(t, this.baseUrl);
  }

  /**
   * 运行时配置
   * - webviewBaseUrl：dev 默认指向 LAN IP，prod 走域名
   * - 通过环境变量 WEBVIEW_BASE_URL 覆盖
   */
  @Get('tools-config')
  config() {
    return {
      webviewBaseUrl: this.baseUrl,
      env: this.cfg.get<string>('env') || 'development',
    };
  }
}

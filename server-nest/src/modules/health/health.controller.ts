/**
 * 健康检查端点
 * - GET /api/health
 * - 返回服务状态 + DB 连接状态 + 在线数（供监控/load balancer 使用）
 */
import { Controller, Get } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { AgentGateway } from '../agent-gateway/agent.gateway';

@Controller('api')
export class HealthController {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly agentGateway: AgentGateway,
  ) {}

  @Get('health')
  async check() {
    let dbOk = false;
    try {
      await this.dataSource.query('SELECT 1');
      dbOk = true;
    } catch {
      dbOk = false;
    }
    return {
      ok: dbOk,
      time: Date.now(),
      db: dbOk ? 'up' : 'down',
      stats: this.agentGateway.getStats(),
    };
  }
}

import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { AgentGatewayModule } from '../agent-gateway/agent-gateway.module';

@Module({
  imports: [AgentGatewayModule],
  controllers: [HealthController],
})
export class HealthModule {}

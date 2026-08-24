/**
 * AgentGatewayModule - 聚合所有依赖模块
 * - 包含 AgentService（仅本模块用）和 AgentGateway
 * - 导入 ClientModule / SessionModule / QueueModule / HistoryModule / SuggestionModule
 * - HealthModule 通过 AgentGateway.getStats() 读在线数
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { AgentEntity } from './entities/agent.entity';
import { AgentService } from './agent.service';
import { AgentGateway } from './agent.gateway';
import { ClientModule } from '../client/client.module';
import { SessionModule } from '../session/session.module';
import { QueueModule } from '../queue/queue.module';
import { HistoryModule } from '../history/history.module';
import { SuggestionModule } from '../suggestion/suggestion.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([AgentEntity]),
    ConfigModule,
    ClientModule,
    SessionModule,
    QueueModule,
    HistoryModule,
    SuggestionModule,
  ],
  providers: [AgentService, AgentGateway],
  exports: [AgentGateway, AgentService],
})
export class AgentGatewayModule {}

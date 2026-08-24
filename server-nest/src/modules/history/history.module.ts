import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { HistorySessionEntity } from './entities/history-session.entity';
import { HistoryService } from './history.service';

@Module({
  imports: [TypeOrmModule.forFeature([HistorySessionEntity]), ConfigModule],
  providers: [HistoryService],
  exports: [HistoryService],
})
export class HistoryModule {}

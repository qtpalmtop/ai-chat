import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { QueueEntryEntity } from './entities/queue-entry.entity';
import { QueueService } from './queue.service';

@Module({
  imports: [TypeOrmModule.forFeature([QueueEntryEntity])],
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}

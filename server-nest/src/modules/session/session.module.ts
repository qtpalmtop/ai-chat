import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SessionEntity } from './entities/session.entity';
import { MessageEntity } from './entities/message.entity';
import { SessionService } from './session.service';

@Module({
  imports: [TypeOrmModule.forFeature([SessionEntity, MessageEntity])],
  providers: [SessionService],
  exports: [SessionService],
})
export class SessionModule {}

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SsrService } from './ssr.service';

@Module({
  imports: [ConfigModule],
  providers: [SsrService],
  exports: [SsrService],
})
export class SsrModule {}

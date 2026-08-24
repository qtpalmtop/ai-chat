/**
 * 工具模块：暴露 /api/tools 列表
 * - 默认从 DB 拉取
 * - 若 DB 为空，自动 seed 一条豆包 AI 助手
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ToolEntity } from './entities/tool.entity';
import { ToolService } from './tool.service';
import { ToolController } from './tool.controller';

@Module({
  imports: [TypeOrmModule.forFeature([ToolEntity])],
  providers: [ToolService],
  controllers: [ToolController],
  exports: [ToolService],
})
export class ToolModule {}

/**
 * 设备模块：App 启动时注册设备
 * - POST /api/devices           注册/更新设备，返回 deviceId + tools + webviewBaseUrl
 * - POST /api/devices/location  上报位置
 */
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceEntity } from './entities/device.entity';
import { DeviceService } from './device.service';
import { DeviceController } from './device.controller';
import { ToolModule } from '../tool/tool.module';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceEntity]), ToolModule],
  providers: [DeviceService],
  controllers: [DeviceController],
  exports: [DeviceService],
})
export class DeviceModule {}

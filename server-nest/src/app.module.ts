/**
 * AppModule - 根模块
 * - 加载配置
 * - 连接 TypeORM（PostgreSQL）
 * - 注册所有业务模块
 */
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule, TypeOrmModuleOptions } from '@nestjs/typeorm';
import configuration from './config/configuration';
import { dataSourceOptions } from './database/data-source';
import { HealthModule } from './modules/health/health.module';
import { ChatModule } from './modules/chat/chat.module';
import { AgentGatewayModule } from './modules/agent-gateway/agent-gateway.module';
import { SsrModule } from './modules/ssr/ssr.module';
import { ToolModule } from './modules/tool/tool.module';
import { DeviceModule } from './modules/device/device.module';
// import { HttpRoutingMiddleware } from './modules/ssr/http-routing.middleware';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env.local', '.env'],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService): TypeOrmModuleOptions => {
        const base = dataSourceOptions as Extract<typeof dataSourceOptions, { type: 'postgres' }>;
        return {
          ...base,
          host: config.get<string>('database.host') ?? base.host,
          port: config.get<number>('database.port') ?? base.port,
          username: config.get<string>('database.user') ?? base.username,
          password: config.get<string>('database.password') ?? base.password,
          database: config.get<string>('database.name') ?? base.database,
        };
      },
    }),
    HealthModule,
    ChatModule,
    AgentGatewayModule,
    SsrModule,
    ToolModule,
    DeviceModule,
  ],
})
export class AppModule {
  // configure(consumer: MiddlewareConsumer) {
  //   consumer.apply(HttpRoutingMiddleware).forRoutes('*');
  // }
}

/**
 * TypeORM DataSource：CLI migration 命令和运行时共用
 * - CLI 用法：typeorm-ts-node-commonjs migration:run -d src/database/data-source.ts
 * - 运行时：@nestjs/typeorm 的 TypeOrmModule.forRootAsync 引用这里的连接信息
 */
import 'reflect-metadata';
import { DataSource, DataSourceOptions } from 'typeorm';
import * as path from 'path';
import * as dotenv from 'dotenv';

// CLI 场景下没有 @nestjs/config 帮忙 load .env，手动 load 一次
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || '127.0.0.1',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USER || 'doubao',
  password: process.env.DB_PASSWORD || 'doubao_pwd',
  database: process.env.DB_NAME || 'doubao_ai',
  // 实体类路径（生产用 build 产物，开发用 src）
  entities: [path.join(__dirname, '..', '**', '*.entity.{ts,js}')],
  migrations: [path.join(__dirname, 'migrations', '*.{ts,js}')],
  // synchronize 仅在开发用，生产必须用 migration
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.DB_LOG === '1',
  // 重要：不要用 snake_case 自动转换，TypeORM 默认按实体字段名生成列名
  // 这样列名 camelCase 直观、JS 端访问也直观
  // （如果团队偏好 snake_case，可以打开 namingStrategy: new SnakeNamingStrategy()）
};

const dataSource = new DataSource(dataSourceOptions);
export default dataSource;

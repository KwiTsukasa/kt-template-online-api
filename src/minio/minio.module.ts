import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { MinioClientController } from './minio.controller';
import { MinioClientService } from './minio.service';
import { ToolsService } from '@/common';

@Module({
  imports: [ConfigModule],
  controllers: [MinioClientController],
  providers: [MinioClientService, ToolsService],
  exports: [MinioClientService],
})
export class MinioClientModule {}

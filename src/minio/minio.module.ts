import { Module } from '@nestjs/common';
import { MinioClientController } from './minio.controller';
import { MinioClientService } from './minio.service';
import { ToolsService } from 'src/utils/tool.service';
import { MinioModule } from 'nestjs-minio-client';

@Module({
  imports: [MinioModule],
  controllers: [MinioClientController],
  providers: [MinioClientService, ToolsService],
  exports: [MinioClientService],
})
export class MinioClientModule {}

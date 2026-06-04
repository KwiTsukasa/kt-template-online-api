import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AdminAuthGuardModule } from '@/admin/auth/admin-auth-guard.module';
import { MinioClientController } from './minio.controller';
import { MinioClientService } from './minio.service';

@Module({
  imports: [AdminAuthGuardModule, ConfigModule],
  controllers: [MinioClientController],
  providers: [MinioClientService],
  exports: [MinioClientService],
})
export class MinioClientModule {}

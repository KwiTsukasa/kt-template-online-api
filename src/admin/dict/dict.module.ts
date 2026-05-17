import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '../auth/admin-auth-guard.module';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { ToolsService } from '@/common';
import { AdminDict } from './admin-dict.entity';

@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([AdminDict])],
  controllers: [DictController],
  providers: [DictService, ToolsService],
  exports: [DictService],
})
export class DictModule {}

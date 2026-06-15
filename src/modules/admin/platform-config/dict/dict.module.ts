import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdminAuthGuardModule } from '../../identity/auth/admin-auth-guard.module';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { AdminDict } from './admin-dict.entity';

@Module({
  imports: [AdminAuthGuardModule, TypeOrmModule.forFeature([AdminDict])],
  controllers: [DictController],
  providers: [DictService],
  exports: [DictService],
})
export class DictModule {}

import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { ToolsService } from '@/common';
import { AdminDict } from './admin-dict.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AdminDict])],
  controllers: [DictController],
  providers: [DictService, ToolsService],
  exports: [DictService],
})
export class DictModule {}

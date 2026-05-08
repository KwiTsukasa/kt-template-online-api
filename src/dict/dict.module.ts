import { Module } from '@nestjs/common';
import { DictController } from './dict.controller';
import { DictService } from './dict.service';
import { ToolsService } from 'src/utils/tool.service';

@Module({
  controllers: [DictController],
  providers: [DictService, ToolsService],
  exports: [DictService],
})
export class DictModule {}

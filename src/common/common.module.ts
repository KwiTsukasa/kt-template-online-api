import { Global, Module } from '@nestjs/common';
import { ToolsService } from './services/tool.service';

@Global()
@Module({
  exports: [ToolsService],
  providers: [ToolsService],
})
export class CommonModule {}

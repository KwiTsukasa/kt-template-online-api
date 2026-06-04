import { Global, Module } from '@nestjs/common';
import { LokiLogPublisherService } from './logger/loki-log-publisher.service';
import { ToolsService } from './services/tool.service';

@Global()
@Module({
  exports: [LokiLogPublisherService, ToolsService],
  providers: [LokiLogPublisherService, ToolsService],
})
export class CommonModule {}

import { Global, Module } from '@nestjs/common';
import { LokiLogPublisherService } from './logger/loki-log-publisher.service';
import { MarkdownService } from './services/markdown.service';
import { ToolsService } from './services/tool.service';

@Global()
@Module({
  exports: [LokiLogPublisherService, MarkdownService, ToolsService],
  providers: [LokiLogPublisherService, MarkdownService, ToolsService],
})
export class CommonModule {}

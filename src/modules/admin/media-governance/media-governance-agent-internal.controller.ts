import {
  Body,
  Controller,
  Get,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  MediaGovernanceAgentEventDto,
  MediaGovernanceAgentToolCallDto,
} from './media-governance.dto';
import { MediaGovernanceAgentInternalGuard } from './media-governance-agent-internal.guard';
import { MediaGovernanceService } from './media-governance.service';

@Controller('internal/media-governance/agent')
@UseGuards(MediaGovernanceAgentInternalGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class MediaGovernanceAgentInternalController {
  constructor(private readonly service: MediaGovernanceService) {}

  @Get('health')
  health() {
    return {
      ...this.service.agentCallbackHealth(),
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    };
  }

  @Post('tool-calls')
  async toolCall(@Body() body: MediaGovernanceAgentToolCallDto) {
    return this.service.agentToolCall(body);
  }

  @Post('events')
  async event(@Body() body: MediaGovernanceAgentEventDto) {
    return this.service.applyAgentEvent(body);
  }
}

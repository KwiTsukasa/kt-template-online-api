import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { MediaCodexAgentGatewayService } from '../application/media-codex-agent-gateway.service';
import { MEDIA_CODEX_AGENT_POLICY_VERSION } from '../domain/media-codex-agent.contract';
import { MediaCodexAgentInternalGuard } from './media-codex-agent-internal.guard';
import { MediaCodexAgentTurnRequestDto } from './media-codex-agent.dto';

@Controller('internal/media-codex-agent')
@UseGuards(MediaCodexAgentInternalGuard)
export class MediaCodexAgentController {
  constructor(private readonly service: MediaCodexAgentGatewayService) {}

  @Get('health')
  async health() {
    let readiness;
    try {
      readiness = await this.service.health();
    } catch {
      throw new ServiceUnavailableException(
        'media-codex-agent-dependency-unavailable',
      );
    }
    return {
      ...readiness,
      appServerReady: true,
      appServerTransport: 'unix',
      loginStateExposed: false,
      policyVersion: MEDIA_CODEX_AGENT_POLICY_VERSION,
      rawProtocolExposed: false,
      status: 'ready',
      writeBoundaries: {
        cloud: 0,
        database: 0,
        formalMedia: 0,
        ui: 0,
      },
    };
  }

  @Post('tasks/:taskId/turns')
  async startTurn(
    @Param('taskId') taskId: string,
    @Body() body: MediaCodexAgentTurnRequestDto,
  ) {
    if (taskId !== body.taskId) {
      throw new ConflictException('media-codex-agent-task-identity-mismatch');
    }
    return this.service.startTurn(body);
  }

  @Get('tasks/:taskId/session')
  session(@Param('taskId') taskId: string) {
    const session = this.service.session(taskId);
    if (!session) {
      throw new NotFoundException('media-codex-agent-session-not-found');
    }
    return session;
  }
}

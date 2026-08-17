import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import { MediaCodexAgentGatewayService } from '../application/media-codex-agent-gateway.service';
import { MEDIA_CODEX_AGENT_POLICY_VERSION } from '../domain/media-codex-agent.contract';
import { MediaCodexAgentInternalGuard } from './media-codex-agent-internal.guard';
import {
  MediaCodexAgentSessionQueryDto,
  MediaCodexAgentTurnRequestDto,
} from './media-codex-agent.dto';

@Controller('internal/media-codex-agent')
@UseGuards(MediaCodexAgentInternalGuard)
export class MediaCodexAgentController {
  constructor(private readonly service: MediaCodexAgentGatewayService) {}

  /** 汇总网关及依赖就绪状态，并公开固定的安全边界声明。 */
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

  /** 校验路径与请求体任务身份一致后启动一个受管 Agent 回合。 */
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

  /** 查询指定任务的安全会话投影，并在不存在时返回明确错误。 */
  @Get('tasks/:taskId/session')
  async session(
    @Param('taskId') taskId: string,
    @Query() query: MediaCodexAgentSessionQueryDto,
  ) {
    const session = await this.service.session(
      taskId,
      query.afterSequence,
      query.limit,
    );
    if (!session) {
      throw new NotFoundException('media-codex-agent-session-not-found');
    }
    return session;
  }
}

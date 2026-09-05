import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentAdminUser, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import type { AdminUser } from '@/modules/admin/identity/user/admin-user.entity';
import { CodexRemoteService } from '../application/codex-remote.service';
import { CodexCoordinationService } from '../application/codex-coordination.service';
import { CodexRemoteSessionDto } from '../contract/codex-remote.dto';

@ApiTags('Admin - Codex Remote')
@Controller('codex-remote')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class CodexRemoteController {
  constructor(
    private readonly remote: CodexRemoteService,
    private readonly coordination: CodexCoordinationService,
  ) {}

  /**
   * 读取 KT 跨任务协调快照，并禁止缓存当前任务和资源状态。
   * @param user - 当前超级管理员身份。
   * @param response - 用于设置缓存策略的响应。
   * @returns 管理端成功包裹的实时协调快照。
   */
  @Get('coordination')
  @ApiOperation({ summary: '读取 KT 跨任务协调中心' })
  async coordinationSnapshot(
    @CurrentAdminUser() user: AdminUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(await this.coordination.snapshot(user));
  }

  /**
   * 建立仅当前管理员可读的协调事件流，连接结束时释放 PC 上游订阅。
   * @param user - 当前超级管理员身份。
   * @param response - 承载原始 SSE 数据的响应。
   * @returns 上游订阅结束后的完成结果。
   */
  @Get('coordination/events')
  @ApiOperation({ summary: '订阅 KT 跨任务实时变化' })
  coordinationEvents(
    @CurrentAdminUser() user: AdminUser,
    @Res() response: Response,
  ) {
    return this.coordination.stream(user, response);
  }

  /**
   * 返回当前部署完整配置的 PC/NAS Remote 节点和项目目录。
   * @param response - 用于禁止缓存节点动态配置的 HTTP 响应。
   * @returns 不含签名密钥的节点目录。
   */
  @Get('nodes')
  @ApiOperation({ summary: '获取 Codex Remote 节点与项目' })
  nodes(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(this.remote.nodes());
  }

  /**
   * 用当前 Admin SSO 身份为一个精确节点/项目签发短期 App Server token。
   * @param nodeId - 目标节点标识。
   * @param body - 目标项目标识。
   * @param user - 当前 Admin 登录用户。
   * @param response - 用于禁止缓存短期 token 的 HTTP 响应。
   * @returns 两分钟 WebSocket session token 与连接参数。
   */
  @Post('nodes/:nodeId/session')
  @ApiOperation({ summary: '签发 Codex Remote 短期会话' })
  session(
    @Param('nodeId') nodeId: string,
    @Body() body: CodexRemoteSessionDto,
    @CurrentAdminUser() user: AdminUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(this.remote.createSession(nodeId, body.projectId, user));
  }
}

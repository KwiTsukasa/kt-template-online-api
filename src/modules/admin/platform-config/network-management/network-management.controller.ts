import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  Sse,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { vbenPage, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/jwt-auth.guard';
import {
  NetworkDdnsListQueryDto,
  NetworkDdnsRecordInputDto,
  NetworkDdnsSourceOptionsQueryDto,
  NetworkEndpointHistoryQueryDto,
  NetworkPortForwardCreateDto,
  NetworkPortForwardListQueryDto,
  NetworkPortForwardUpdateDto,
} from './network-management.dto';
import { NetworkDdnsService } from './network-ddns.service';
import { NetworkManagementService } from './network-management.service';
import { NetworkManagementEventStreamService } from './network-management-event-stream.service';

@ApiTags('Admin - 网络端口转发')
@Controller('system/network')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
@UsePipes(
  new ValidationPipe({
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class NetworkManagementController {
  /**
   * Creates the super-admin-only network desired-state controller.
   * @param service - Persisted port-forward and Agent state service.
   * @param ddnsService - Persisted Tencent Cloud DNS automatic-update service.
   * @param eventStream - Committed MQTT change stream exposed to Admin through SSE.
   */
  constructor(
    private readonly service: NetworkManagementService,
    private readonly ddnsService: NetworkDdnsService,
    private readonly eventStream: NetworkManagementEventStreamService,
  ) {}

  /**
   * Subscribes Admin to committed network-state changes without exposing MQTT credentials.
   * @param lastEventIdHeader - Native EventSource replay cursor.
   * @param lastEventIdQuery - Query fallback retained across keep-alive deactivation.
   * @returns SSE observable containing typed state changes and cursor-pinned heartbeats.
   */
  @Sse('events/stream')
  @ApiOperation({ summary: '订阅网络管理状态变化' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }

  /** Lists persisted mappings without returning expired endpoint leases. */
  @Get('port-forward/list')
  @ApiOperation({ summary: '分页查询端口转发' })
  async list(
    @Query() query: NetworkPortForwardListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.list(query);
    return vbenPage(page.items, page.total);
  }

  /** Persists a new TCP or UDP desired mapping without waiting for Agent apply. */
  @Post('port-forward')
  @ApiOperation({ summary: '新增端口转发' })
  async create(
    @Body() body: NetworkPortForwardCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

  /** Updates one desired mapping and advances the global revision once. */
  @Put('port-forward/:id')
  @ApiOperation({ summary: '修改端口转发' })
  async update(
    @Param('id') id: string,
    @Body() body: NetworkPortForwardUpdateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.update(id, body));
  }

  /** Starts confirmed asynchronous deletion while retaining the active key. */
  @Delete('port-forward/:id')
  @ApiOperation({ summary: '删除端口转发' })
  async remove(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.remove(id));
  }

  /** Requeues reconciliation for the current desired mapping. */
  @Post('port-forward/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试端口转发同步' })
  async retry(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.retry(id));
  }

  /** Enables continuous UDP Keeper and requests an immediate probe. */
  @Post('port-forward/:id/keeper/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 UDP STUN 保活' })
  async enableKeeper(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.enableKeeper(id));
  }

  /** Disables continuous UDP Keeper and immediately hides its public lease. */
  @Post('port-forward/:id/keeper/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 UDP STUN 保活' })
  async disableKeeper(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.disableKeeper(id));
  }

  /** Generates a new idempotent immediate-probe request for an enabled UDP Keeper. */
  @Post('port-forward/:id/probe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '立即刷新 UDP 公网端点' })
  async probe(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.probe(id));
  }

  /** Lists append-only endpoint state-change history for one desired mapping. */
  @Get('port-forward/:id/endpoint-history')
  @ApiOperation({ summary: '查询公网端点历史' })
  async endpointHistory(
    @Param('id') id: string,
    @Query() query: NetworkEndpointHistoryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.endpointHistory(id, query);
    return vbenPage(page.items, page.total);
  }

  /** Returns independent Agent connectivity and revision convergence state. */
  @Get('agent/status')
  @ApiOperation({ summary: '查询网络 Agent 状态' })
  async agentStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(await this.service.agentStatus());
  }

  /** Lists persisted automatic-DDNS bindings independently from port forwards. */
  @Get('ddns/list')
  @ApiOperation({ summary: '分页查询自动 DDNS' })
  async listDdns(
    @Query() query: NetworkDdnsListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.ddnsService.list(query);
    return vbenPage(page.items, page.total);
  }

  /** Returns server-evaluated IPv4 or IPv6 source choices for one record type. */
  @Get('ddns/source-options')
  @ApiOperation({ summary: '查询自动 DDNS 地址来源' })
  async ddnsSourceOptions(
    @Query() query: NetworkDdnsSourceOptionsQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess({
      items: await this.ddnsService.sourceOptions(query),
    });
  }

  /** Returns redacted Tencent Cloud DNS readiness without any credential value. */
  @Get('ddns/provider-status')
  @ApiOperation({ summary: '查询腾讯云云解析 DNS 状态' })
  async ddnsProviderStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.ddnsService.getProviderStatus());
  }

  /** Persists one asynchronous A or AAAA automatic-update binding. */
  @Post('ddns')
  @ApiOperation({ summary: '新增自动 DDNS' })
  async createDdns(
    @Body() body: NetworkDdnsRecordInputDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.create(body));
  }

  /** Replaces the editable identity and source of one DDNS binding. */
  @Put('ddns/:id')
  @ApiOperation({ summary: '修改自动 DDNS' })
  async updateDdns(
    @Param('id') id: string,
    @Body() body: NetworkDdnsRecordInputDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.update(id, body));
  }

  /** Deletes only the local updater while leaving the Tencent Cloud DNS record intact. */
  @Delete('ddns/:id')
  @ApiOperation({ summary: '删除本地自动 DDNS' })
  async removeDdns(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.remove(id));
  }

  /** Requeues one enabled DDNS binding for immediate provider reconciliation. */
  @Post('ddns/:id/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试自动 DDNS 同步' })
  async retryDdns(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.retry(id));
  }

  /**
   * Marks all dynamic network state responses as non-cacheable.
   * @param response - Express response receiving the fixed directive.
   */
  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
}

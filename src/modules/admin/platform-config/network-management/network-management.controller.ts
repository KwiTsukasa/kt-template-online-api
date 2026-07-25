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
  constructor(
    private readonly service: NetworkManagementService,
    private readonly ddnsService: NetworkDdnsService,
    private readonly eventStream: NetworkManagementEventStreamService,
  ) {}

  @Sse('events/stream')
  @ApiOperation({ summary: '订阅网络管理状态变化' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }

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

  @Post('port-forward')
  @ApiOperation({ summary: '新增端口转发' })
  async create(
    @Body() body: NetworkPortForwardCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

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

  @Delete('port-forward/:id')
  @ApiOperation({ summary: '删除端口转发' })
  async remove(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.remove(id));
  }

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

  @Get('agent/status')
  @ApiOperation({ summary: '查询网络 Agent 状态' })
  async agentStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(await this.service.agentStatus());
  }

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

  @Get('ddns/provider-status')
  @ApiOperation({ summary: '查询腾讯云云解析 DNS 状态' })
  async ddnsProviderStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.ddnsService.getProviderStatus());
  }

  @Post('ddns')
  @ApiOperation({ summary: '新增自动 DDNS' })
  async createDdns(
    @Body() body: NetworkDdnsRecordInputDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.create(body));
  }

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

  @Delete('ddns/:id')
  @ApiOperation({ summary: '删除本地自动 DDNS' })
  async removeDdns(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.remove(id));
  }

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

  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
}

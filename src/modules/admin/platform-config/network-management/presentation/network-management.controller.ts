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
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import {
  NetworkDdnsListQueryDto,
  NetworkDdnsRecordInputDto,
  NetworkDdnsSourceOptionsQueryDto,
  NetworkEndpointHistoryQueryDto,
  NetworkPortForwardCreateDto,
  NetworkPortForwardListQueryDto,
  NetworkPortForwardUpdateDto,
} from '@/modules/admin/platform-config/network-management/contract/network-management.dto';
import { NetworkDdnsService } from '@/modules/admin/platform-config/network-management/application/network-ddns.service';
import { NetworkManagementService } from '@/modules/admin/platform-config/network-management/application/network-management.service';
import { NetworkManagementEventStreamService } from '@/modules/admin/platform-config/network-management/application/network-management-event-stream.service';

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

  /**
   * 通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流。
   * @param lastEventIdHeader - 决定通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流内容、边界或目标的 `lastEventIdHeader` 值；为空时采用 `lastEventIdQuery` 作为兜底。
   * @param lastEventIdQuery - 决定通过建立包含可重放事件、实时提交事件与定时心跳的服务端事件流内容、边界或目标的 `lastEventIdQuery` 值；省略时不启用与该参数关联的可选筛选、覆盖或副作用。
   * @returns 返回合并历史重放、实时事件与定时心跳的只读 Observable。
   */
  @Sse('events/stream')
  @ApiOperation({ summary: '订阅网络管理状态变化' })
  stream(
    @Headers('last-event-id') lastEventIdHeader?: string,
    @Query('lastEventId') lastEventIdQuery?: string,
  ) {
    return this.eventStream.stream(lastEventIdHeader || lastEventIdQuery);
  }

  /**
   * 按`query`、`response`读取网络管理记录；从 `service.list` 读取网络管理记录。
   * @param query - 限定网络管理记录筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络管理记录。
   */
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

  /**
   * 根据`body`、`response`构造网络管理记录。
   * @param body - 用于网络管理记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络管理记录。
   */
  @Post('port-forward')
  @ApiOperation({ summary: '新增端口转发' })
  async create(
    @Body() body: NetworkPortForwardCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

  /**
   * 根据`id`、`body`、`response`更新网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param body - 用于网络管理记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络管理记录。
   */
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

  /**
   * 按`id`、`response`移除网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络管理记录。
   */
  @Delete('port-forward/:id')
  @ApiOperation({ summary: '删除端口转发' })
  async remove(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.remove(id));
  }

  /**
   * 根据`id`、`response`处理网络管理记录。
   * @param id - 决定网络管理记录内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络管理记录。
   */
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

  /**
   * 禁止响应缓存后按通道标识启用 UDP STUN 保活，并封装更新后的兼容通道视图。
   * @param id - 决定保活器内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回启用保活后的目标网络通道视图或对应成功响应。
   */
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

  /**
   * 按`id`、`response`停止保活器并清理该入口拥有的运行态资源。
   * @param id - 决定保活器内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回禁用保活后的目标网络通道视图或对应成功响应。
   */
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

  /**
   * 触发目标网络通道的即时连通性探测，并返回提交后的通道状态。
   * @param id - 决定probe内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回即时探测后的目标网络通道视图或对应成功响应。
   */
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

  /**
   * 按目标 ID、协议与分页条件查询端点变更历史，并投影为管理端视图。
   * @param id - 决定端点历史内容、边界或目标的 `id` 值。
   * @param query - 限定端点历史筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 端点历史。
   */
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

  /**
   * 按输入分支映射Agent状态。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 按输入分支映射Agent状态。
   */
  @Get('agent/status')
  @ApiOperation({ summary: '查询网络 Agent 状态' })
  async agentStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(await this.service.agentStatus());
  }

  /**
   * 按`query`、`response`读取动态域名记录；从 `ddnsService.list` 读取动态域名记录。
   * @param query - 限定动态域名记录筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 动态域名记录。
   */
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

  /**
   * 把来源状态投影为DDNS来源选项。
   * @param query - 限定把来源状态投影为DDNS来源选项筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 把来源状态投影为DDNS来源选项。
   */
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

  /**
   * 按输入分支映射DDNS资料源状态。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 按输入分支映射DDNS资料源状态。
   */
  @Get('ddns/provider-status')
  @ApiOperation({ summary: '查询腾讯云云解析 DNS 状态' })
  async ddnsProviderStatus(@Res({ passthrough: true }) response: Response) {
    this.noStore(response);
    return vbenSuccess(this.ddnsService.getProviderStatus());
  }

  /**
   * 根据`body`、`response`构造动态域名记录。
   * @param body - 用于动态域名记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 动态域名记录。
   */
  @Post('ddns')
  @ApiOperation({ summary: '新增自动 DDNS' })
  async createDdns(
    @Body() body: NetworkDdnsRecordInputDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.create(body));
  }

  /**
   * 根据`id`、`body`、`response`更新动态域名记录。
   * @param id - 决定动态域名记录内容、边界或目标的 `id` 值。
   * @param body - 用于动态域名记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 动态域名记录。
   */
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

  /**
   * 按`id`、`response`移除动态域名记录。
   * @param id - 决定动态域名记录内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 动态域名记录。
   */
  @Delete('ddns/:id')
  @ApiOperation({ summary: '删除本地自动 DDNS' })
  async removeDdns(
    @Param('id') id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.ddnsService.remove(id));
  }

  /**
   * 根据`id`、`response`处理动态域名记录。
   * @param id - 决定动态域名记录内容、边界或目标的 `id` 值。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 动态域名记录。
   */
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
   * 写入禁止缓存响应头，确保网络状态与端点操作不会被浏览器或中间代理复用。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   */
  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
}

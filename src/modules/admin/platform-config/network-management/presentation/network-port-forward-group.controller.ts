import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { vbenPage, vbenSuccess } from '@/common';
import { AdminSuperGuard } from '@/modules/admin/identity/auth/presentation/admin-super.guard';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';
import { NetworkEndpointHistoryQueryDto } from '@/modules/admin/platform-config/network-management/contract/network-management.dto';
import {
  NetworkPortForwardGroupChannelMutationDto,
  NetworkPortForwardGroupChannelParamsDto,
  NetworkPortForwardGroupCreateDto,
  NetworkPortForwardGroupListQueryDto,
  NetworkPortForwardGroupParamsDto,
  NetworkPortForwardGroupUpdateDto,
} from '@/modules/admin/platform-config/network-management/contract/network-port-forward-group.dto';
import { NetworkPortForwardGroupService } from '@/modules/admin/platform-config/network-management/application/network-port-forward-group.service';

@ApiTags('Admin - 网络逻辑端口转发组')
@Controller('system/network/port-forward-group')
@UseGuards(JwtAuthGuard, AdminSuperGuard)
@UsePipes(
  new ValidationPipe({
    exceptionFactory: () =>
      new HttpException(
        {
          err: '请求参数不符合接口约束',
          msg: '请求参数校验失败',
        },
        HttpStatus.BAD_REQUEST,
      ),
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  }),
)
export class NetworkPortForwardGroupController {
  constructor(private readonly service: NetworkPortForwardGroupService) {}

  /**
   * 按`query`、`response`读取网络端口转发分组记录；从 `service.list` 读取网络端口转发分组记录。
   * @param query - 限定网络端口转发分组记录筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络端口转发分组记录。
   */
  @Get('list')
  @ApiOperation({ summary: '分页查询逻辑端口转发组' })
  async list(
    @Query() query: NetworkPortForwardGroupListQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.list(query);
    return vbenPage(page.items, page.total);
  }

  /**
   * 根据`body`、`response`构造网络端口转发分组记录。
   * @param body - 用于网络端口转发分组记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络端口转发分组记录。
   */
  @Post()
  @ApiOperation({ summary: '新增逻辑端口转发组' })
  async create(
    @Body() body: NetworkPortForwardGroupCreateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.create(body));
  }

  /**
   * 根据`params`、`body`、`response`更新网络端口转发分组记录。
   * @param params - 用于网络端口转发分组记录的领域对象，包含 `groupId` 字段。
   * @param body - 用于网络端口转发分组记录的结构化输入。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络端口转发分组记录。
   */
  @Put(':groupId')
  @ApiOperation({ summary: '修改逻辑端口转发组' })
  async update(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupUpdateDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.update(params.groupId, body));
  }

  /**
   * 按`params`、`response`移除网络端口转发分组记录。
   * @param params - 用于网络端口转发分组记录的领域对象，包含 `groupId` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络端口转发分组记录。
   */
  @Delete(':groupId')
  @ApiOperation({ summary: '删除逻辑端口转发组' })
  async remove(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.remove(params.groupId));
  }

  /**
   * 根据`params`、`response`处理网络端口转发分组记录。
   * @param params - 用于网络端口转发分组记录的领域对象，包含 `groupId`、`protocol` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 网络端口转发分组记录。
   */
  @Post(':groupId/channels/:protocol/retry')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '重试协议通道同步' })
  async retry(
    @Param() params: NetworkPortForwardGroupChannelParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.retry(params.groupId, params.protocol),
    );
  }

  /**
   * 按目标 ID、协议与分页条件查询端点变更历史，并投影为管理端视图。
   * @param params - 用于端点历史的领域对象，包含 `groupId`、`protocol` 字段。
   * @param query - 限定端点历史筛选、排序与分页范围的查询条件。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 端点历史。
   */
  @Get(':groupId/channels/:protocol/endpoint-history')
  @ApiOperation({ summary: '查询协议通道公网端点历史' })
  async endpointHistory(
    @Param() params: NetworkPortForwardGroupChannelParamsDto,
    @Query() query: NetworkEndpointHistoryQueryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    const page = await this.service.endpointHistory(
      params.groupId,
      params.protocol,
      query,
    );
    return vbenPage(page.items, page.total);
  }

  /**
   * 禁止响应缓存后校验期望修订号并启用分组的 TCP NATMap，随后封装更新后的通道状态。
   * @param params - 用于NATMap 转发的领域对象，包含 `groupId` 字段。
   * @param body - 用于NATMap 转发的结构化输入，包含 `expectedDesiredRevision` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns NATMap 转发。
   */
  @Post(':groupId/channels/tcp/natmap/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 TCP NATMap' })
  async enableNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.enableNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  /**
   * 按`params`、`body`、`response`停止NATMap 转发并清理该入口拥有的运行态资源。
   * @param params - 用于NATMap 转发的领域对象，包含 `groupId` 字段。
   * @param body - 用于NATMap 转发的结构化输入，包含 `expectedDesiredRevision` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns NATMap 转发。
   */
  @Post(':groupId/channels/tcp/natmap/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 TCP NATMap' })
  async disableNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.disableNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  /**
   * 启用逻辑组的 UDP NATMap forward，并保留 Keeper 作为互斥机制。
   * @param params - 包含目标逻辑组 ID 的路由参数。
   * @param body - 可选的通道 desiredRevision 并发前置条件。
   * @param response - 接收禁止缓存响应头的当前 HTTP 响应。
   * @returns 启用后的 UDP NATMap 通道状态。
   */
  @Post(':groupId/channels/udp/natmap/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 UDP NATMap' })
  async enableUdpNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.enableUdpNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  /**
   * 停用逻辑组的 UDP NATMap forward，并撤下其公网端点。
   * @param params - 包含目标逻辑组 ID 的路由参数。
   * @param body - 可选的通道 desiredRevision 并发前置条件。
   * @param response - 接收禁止缓存响应头的当前 HTTP 响应。
   * @returns 停用后的 UDP NATMap 通道状态。
   */
  @Post(':groupId/channels/udp/natmap/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 UDP NATMap' })
  async disableUdpNatmap(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Body() body: NetworkPortForwardGroupChannelMutationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(
      await this.service.disableUdpNatmap(
        params.groupId,
        body.expectedDesiredRevision,
      ),
    );
  }

  /**
   * 禁止响应缓存后启用分组的 UDP STUN 保活，并封装更新后的通道状态。
   * @param params - 用于保活器的领域对象，包含 `groupId` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回启用保活后的目标网络通道视图或对应成功响应。
   */
  @Post(':groupId/channels/udp/keeper/enable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '启用 UDP STUN Keeper' })
  async enableKeeper(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.enableKeeper(params.groupId));
  }

  /**
   * 按`params`、`response`停止保活器并清理该入口拥有的运行态资源。
   * @param params - 用于保活器的领域对象，包含 `groupId` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回禁用保活后的目标网络通道视图或对应成功响应。
   */
  @Post(':groupId/channels/udp/keeper/disable')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '停用 UDP STUN Keeper' })
  async disableKeeper(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.disableKeeper(params.groupId));
  }

  /**
   * 触发目标网络通道的即时连通性探测，并返回提交后的通道状态。
   * @param params - 用于probe的领域对象，包含 `groupId` 字段。
   * @param response - 接收本次接口响应体并结束请求的当前 HTTP 响应。
   * @returns 返回即时探测后的目标网络通道视图或对应成功响应。
   */
  @Post(':groupId/channels/udp/keeper/probe')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '立即刷新 UDP 公网端点' })
  async probe(
    @Param() params: NetworkPortForwardGroupParamsDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    this.noStore(response);
    return vbenSuccess(await this.service.probe(params.groupId));
  }

  /**
   * 写入禁止缓存响应头，确保网络状态与端点操作不会被浏览器或中间代理复用。
   * @param response - 用于写入状态码、Cookie 或缓存策略的当前 HTTP 响应。
   */
  private noStore(response: Response): void {
    response.setHeader('Cache-Control', 'no-store');
  }
}

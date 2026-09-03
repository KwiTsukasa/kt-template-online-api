import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public, vbenSuccess } from '@/common';
import { NetworkWireGuardEndpointService } from '@/modules/admin/platform-config/network-management/application/network-wireguard-endpoint.service';
import { NetworkWireGuardEndpointGuard } from './network-wireguard-endpoint.guard';

@ApiTags('Internal - WireGuard endpoint')
@Controller('system/network/wireguard')
@UseGuards(NetworkWireGuardEndpointGuard)
export class NetworkWireGuardEndpointController {
  constructor(private readonly service: NetworkWireGuardEndpointService) {}

  /**
   * 向现有 Windows Relay 返回单一受管 UDP NATMap 端点，并明确禁止缓存。
   * @param response - 接收 no-store 响应头的当前 HTTP 响应。
   * @returns Vben 成功包装的最小端点投影。
   */
  @Get('endpoint')
  @Public()
  @ApiOperation({ summary: '读取 WireGuard UDP NATMap 端点' })
  async endpoint(@Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return vbenSuccess(await this.service.current());
  }
}

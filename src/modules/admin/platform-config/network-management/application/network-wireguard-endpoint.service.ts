import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NetworkPortForward } from '@/modules/admin/platform-config/network-management/infrastructure/persistence/network-management.entity';

const WIREGUARD_NATMAP_EXTERNAL_PORT = 51825;
const WIREGUARD_TARGET_PORT = 51820;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

@Injectable()
export class NetworkWireGuardEndpointService {
  constructor(
    @InjectRepository(NetworkPortForward)
    private readonly repository: Repository<NetworkPortForward>,
  ) {}

  /**
   * 返回唯一已同步且租约有效的 WireGuard UDP NATMap 公网端点，任何半状态都失败关闭。
   * @returns Relay 可消费的最小 UDP 端点投影。
   * @throws 当前受管通道缺失、重复、未同步或租约失效时抛出 503。
   */
  async current() {
    const channels = await this.repository.find({
      take: 2,
      where: {
        desiredPresence: 'present',
        externalPort: WIREGUARD_NATMAP_EXTERNAL_PORT,
        internalPort: WIREGUARD_TARGET_PORT,
        isDeleted: false,
        natmapDesiredEnabled: true,
        protocol: 'udp',
        targetIpv4: '192.168.31.81',
      },
    });
    if (channels.length !== 1) {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    const channel = channels[0];
    const validUntil = new Date(channel.currentValidUntil || 0);
    if (channel.syncStatus !== 'synced' || channel.natmapStatus !== 'active') {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    if (channel.reportedRevision !== channel.desiredRevision) {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    if (!channel.currentPublicIpv4 || !this.validPort(channel.currentPublicPort)) {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    if (!DIGEST_PATTERN.test(channel.currentEndpointIdentity || '')) {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    if (Number.isNaN(validUntil.getTime()) || validUntil.getTime() <= Date.now()) {
      throw new ServiceUnavailableException('WireGuard UDP 端点暂不可用');
    }
    return {
      channelId: String(channel.id),
      endpointIdentity: channel.currentEndpointIdentity,
      mechanism: 'udp_natmap' as const,
      publicIpv4: channel.currentPublicIpv4,
      publicPort: channel.currentPublicPort,
      reportedRevision: channel.reportedRevision,
      validUntil: validUntil.toISOString(),
    };
  }

  /**
   * 将未知端口收窄为 1 至 65535 的整数。
   * @param value - 待校验的公网 UDP 端口。
   * @returns 端口处于协议范围内时返回 true。
   */
  private validPort(value: unknown): value is number {
    return (
      Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 65_535
    );
  }
}

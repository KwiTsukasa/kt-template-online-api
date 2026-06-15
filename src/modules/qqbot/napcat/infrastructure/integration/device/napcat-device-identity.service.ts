import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ensureSnowflakeId } from '@/common';
import { NapcatDeviceIdentity } from '../../persistence/napcat-device-identity.entity';

type ResolveNapcatDeviceIdentityInput = {
  accountId: string;
  containerId?: string;
  selfId?: string;
};

@Injectable()
export class NapcatDeviceIdentityService {
  constructor(
    @InjectRepository(NapcatDeviceIdentity)
    private readonly identityRepository: Repository<NapcatDeviceIdentity>,
    private readonly configService: ConfigService,
  ) {}

  async resolveForAccount(input: ResolveNapcatDeviceIdentityInput) {
    const accountId = `${input.accountId}`.trim();
    const existing = await this.identityRepository.findOne({
      where: { accountId },
    });

    if (existing) {
      const containerId = input.containerId || null;
      if (containerId && existing.containerId !== containerId) {
        await this.identityRepository.update(
          { id: existing.id },
          { containerId },
        );
        existing.containerId = containerId;
      }
      return existing;
    }

    const containerName = this.buildContainerName(input.selfId || accountId);
    const dataDir = `${this.getRootDir()}/${containerName}`;
    const identity = this.identityRepository.create({
      accountId,
      containerId: input.containerId || null,
      dataDir,
      hostname: this.buildHostname(containerName),
      lastLoginEvidence: null,
      macAddress: this.buildMacAddress(accountId, containerName),
      machineIdPath: `${dataDir}/machine-id`,
      verificationStatus: 'pending',
    });
    ensureSnowflakeId(identity);

    return this.identityRepository.save(identity);
  }

  private buildContainerName(seed: string) {
    const prefix = this.getConfig(
      'QQBOT_NAPCAT_CONTAINER_PREFIX',
      'kt-qqbot-napcat',
    );
    const suffix = `${seed || 'unknown'}`
      .replace(/[^a-zA-Z0-9_.-]/g, '-')
      .toLowerCase();
    return `${prefix}-${suffix}`.replace(/-+/g, '-').slice(0, 120);
  }

  private buildHostname(containerName: string) {
    const normalized = containerName
      .replace(/[^a-zA-Z0-9-]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
    if (normalized.length <= 63) return normalized;

    const hash = createHash('sha256').update(containerName).digest('hex');
    return `${normalized.slice(0, 50)}-${hash.slice(0, 12)}`.slice(0, 63);
  }

  private buildMacAddress(accountId: string, containerName: string) {
    const hash = createHash('sha256')
      .update(`${accountId}:${containerName}`)
      .digest('hex');
    return ['02', '42', hash.slice(0, 2), hash.slice(2, 4), hash.slice(4, 6), hash.slice(6, 8)].join(
      ':',
    );
  }

  private getRootDir() {
    return (
      this.getConfig(
        'QQBOT_NAPCAT_ROOT',
        '/vol1/docker/kt-qqbot/napcat-instances',
      )
    ).replace(/[\\/]+$/, '');
  }

  private getConfig(key: string, defaultValue = '') {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }
}

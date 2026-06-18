import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { NapcatRuntimeProfileSnapshot } from '../../domain/runtime/napcat-profile.types';

@Injectable()
export class NapcatRuntimeProfileService {
  /**
   * Initializes the profile resolver used before Docker script generation.
   * @param configService - Nest config provider that supplies image ref, UID/GID, shm size, and profile version.
   */
  constructor(private readonly configService: ConfigService) {}

  /**
   * Resolves the runtime profile for an account-owned NapCat container.
   * @param input - Account, container, data directory, and device identity ids that tie generated profile evidence to persistence.
   * @returns Runtime profile snapshot used by Docker script generation and later persistence.
   */
  resolveRuntimeProfile(input: {
    accountId: string;
    containerId?: string;
    dataDir: string;
    deviceIdentityId?: string;
  }): NapcatRuntimeProfileSnapshot {
    return {
      accountId: input.accountId,
      containerId: input.containerId,
      dataDir: input.dataDir,
      desktopProfileVersion: this.getString(
        'QQBOT_NAPCAT_DESKTOP_PROFILE_VERSION',
        'desktop-cn-v1',
      ),
      deviceIdentityId: input.deviceIdentityId,
      imageRef: this.getString('QQBOT_NAPCAT_IMAGE', ''),
      locale: 'zh_CN.UTF-8',
      persistCache: true,
      persistLocalShare: true,
      persistLogs: true,
      runtimeGid: this.getNumber('QQBOT_NAPCAT_RUNTIME_GID', 1101),
      runtimeUid: this.getNumber('QQBOT_NAPCAT_RUNTIME_UID', 1101),
      shmSize: this.getString('QQBOT_NAPCAT_SHM_SIZE', '512m'),
      timezone: 'Asia/Shanghai',
      xdgCacheHome: '/app/.cache',
      xdgConfigHome: '/app/.config',
      xdgDataHome: '/app/.local/share',
    };
  }

  /**
   * Reads a trimmed string config value for profile generation.
   * @param key - Environment key that controls NapCat runtime profile generation.
   * @param defaultValue - Value used when the key is absent from runtime config.
   * @returns Trimmed string value consumed by Docker script generation.
   */
  private getString(key: string, defaultValue: string) {
    return `${this.configService.get<string>(key) || defaultValue}`.trim();
  }

  /**
   * Reads a positive numeric config value for UID/GID profile fields.
   * @param key - Environment key that should contain a numeric UID/GID value.
   * @param defaultValue - Safe non-root fallback for profile generation.
   * @returns Positive integer used as the container runtime UID/GID.
   */
  private getNumber(key: string, defaultValue: number) {
    const value = Number(this.configService.get<string>(key) || defaultValue);
    return Number.isFinite(value) && value > 0 ? value : defaultValue;
  }
}

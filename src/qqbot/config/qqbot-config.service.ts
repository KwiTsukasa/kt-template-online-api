import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotConfig } from './qqbot-config.entity';

const QQBOT_PERMISSION_CONFIG_KEYS = {
  allowlistEnabled: 'permission.allowlistEnabled',
  blocklistEnabled: 'permission.blocklistEnabled',
} as const;

export type QqbotPermissionConfig = {
  allowlistEnabled: boolean;
  blocklistEnabled: boolean;
};

@Injectable()
export class QqbotConfigService {
  constructor(
    @InjectRepository(QqbotConfig)
    private readonly configRepository: Repository<QqbotConfig>,
  ) {}

  async getPermissionConfig(): Promise<QqbotPermissionConfig> {
    const [allowlistEnabled, blocklistEnabled] = await Promise.all([
      this.getBoolean(QQBOT_PERMISSION_CONFIG_KEYS.allowlistEnabled, false),
      this.getBoolean(QQBOT_PERMISSION_CONFIG_KEYS.blocklistEnabled, true),
    ]);

    return { allowlistEnabled, blocklistEnabled };
  }

  async updatePermissionConfig(
    config: Partial<QqbotPermissionConfig>,
  ): Promise<QqbotPermissionConfig> {
    const tasks: Array<Promise<void>> = [];

    if (typeof config.allowlistEnabled === 'boolean') {
      tasks.push(
        this.setBoolean(
          QQBOT_PERMISSION_CONFIG_KEYS.allowlistEnabled,
          config.allowlistEnabled,
          'QQBot 白名单总开关',
        ),
      );
    }
    if (typeof config.blocklistEnabled === 'boolean') {
      tasks.push(
        this.setBoolean(
          QQBOT_PERMISSION_CONFIG_KEYS.blocklistEnabled,
          config.blocklistEnabled,
          'QQBot 黑名单总开关',
        ),
      );
    }

    await Promise.all(tasks);
    return this.getPermissionConfig();
  }

  private async getBoolean(configKey: string, defaultValue: boolean) {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    if (!record) return defaultValue;
    return record.configValue === 'true';
  }

  private async setBoolean(configKey: string, value: boolean, remark: string) {
    const exists = await this.configRepository.findOne({
      where: { configKey },
    });
    const configValue = value ? 'true' : 'false';

    if (exists) {
      await this.configRepository.update(
        { id: exists.id },
        { configValue, remark },
      );
      return;
    }

    await this.configRepository.save(
      this.configRepository.create({
        configKey,
        configValue,
        remark,
      }),
    );
  }
}

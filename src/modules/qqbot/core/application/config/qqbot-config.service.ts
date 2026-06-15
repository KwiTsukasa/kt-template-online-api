import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QqbotConfig } from '../../infrastructure/persistence/config/qqbot-config.entity';
import type { QqbotPermissionConfig } from '../../contract/qqbot.types';

const QQBOT_PERMISSION_CONFIG_KEYS = {
  allowlistEnabled: 'permission.allowlistEnabled',
  blocklistEnabled: 'permission.blocklistEnabled',
} as const;

@Injectable()
export class QqbotConfigService {
  constructor(
    @InjectRepository(QqbotConfig)
    private readonly configRepository: Repository<QqbotConfig>,
  ) {}

  async getPermissionConfig(): Promise<QqbotPermissionConfig> {
    const [allowlistEnabled, blocklistEnabled] = await Promise.all([
      this.getBooleanConfig(
        QQBOT_PERMISSION_CONFIG_KEYS.allowlistEnabled,
        false,
      ),
      this.getBooleanConfig(
        QQBOT_PERMISSION_CONFIG_KEYS.blocklistEnabled,
        true,
      ),
    ]);

    return { allowlistEnabled, blocklistEnabled };
  }

  async updatePermissionConfig(
    config: Partial<QqbotPermissionConfig>,
  ): Promise<QqbotPermissionConfig> {
    const tasks: Array<Promise<void>> = [];

    if (typeof config.allowlistEnabled === 'boolean') {
      tasks.push(
        this.setBooleanConfig(
          QQBOT_PERMISSION_CONFIG_KEYS.allowlistEnabled,
          config.allowlistEnabled,
          'QQBot 白名单总开关',
        ),
      );
    }
    if (typeof config.blocklistEnabled === 'boolean') {
      tasks.push(
        this.setBooleanConfig(
          QQBOT_PERMISSION_CONFIG_KEYS.blocklistEnabled,
          config.blocklistEnabled,
          'QQBot 黑名单总开关',
        ),
      );
    }

    await Promise.all(tasks);
    return this.getPermissionConfig();
  }

  async getBooleanConfig(configKey: string, defaultValue: boolean) {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    if (!record) return defaultValue;
    return record.configValue === 'true';
  }

  async setBooleanConfig(configKey: string, value: boolean, remark: string) {
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

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
  /**
   * 初始化 QqbotConfigService 实例。
   * @param configRepository - QQBot仓库依赖；影响 constructor 的返回值。
   */
  constructor(
    @InjectRepository(QqbotConfig)
    private readonly configRepository: Repository<QqbotConfig>,
  ) {}

  /**
   * 查询 QQBot 核心数据。
   * @returns QQBot 核心查询结果。
   */
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

  /**
   * Reads a raw QQBot config value for plugin runtime host calls.
   * @param configKey - Package-owned config key requested by a plugin manifest or worker host call.
   * @returns Stored config value, or `undefined` when the key is not configured.
   */
  async getConfigValue(configKey: string): Promise<string | undefined> {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    return record?.configValue ?? undefined;
  }

  /**
   * 更新Permission Config。
   * @param config - config 输入；使用 `allowlistEnabled`、`blocklistEnabled` 字段生成结果。
   * @returns QQBot 核心更新后的状态。
   */
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

  /**
   * 查询 QQBot 核心数据。
   * @param configKey - configKey 输入；限定 QQBot查询范围。
   * @param defaultValue - defaultValue 输入；限定 QQBot查询范围。
   */
  async getBooleanConfig(configKey: string, defaultValue: boolean) {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    if (!record) return defaultValue;
    return record.configValue === 'true';
  }

  /**
   * 设置Boolean Config。
   * @param configKey - configKey 输入；写入 QQBot状态。
   * @param value - 待转换值；写入 QQBot状态。
   * @param remark - remark 输入；写入 QQBot状态。
   */
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BotConfig } from '../../infrastructure/persistence/config/bot-config.entity';
import type { BotPermissionConfig } from '../../contract/bot.types';

const BOT_PERMISSION_CONFIG_KEYS = {
  allowlistEnabled: 'permission.allowlistEnabled',
  blocklistEnabled: 'permission.blocklistEnabled',
} as const;

@Injectable()
export class BotConfigService {
  constructor(
    @InjectRepository(BotConfig)
    private readonly configRepository: Repository<BotConfig>,
  ) {}

  /**
   * 按当前运行态读取权限配置；从 `getBooleanConfig` 读取权限配置。
   * @returns 包含 `allowlistEnabled`、`blocklistEnabled` 字段的权限配置。
   */
  async getPermissionConfig(): Promise<BotPermissionConfig> {
    const [allowlistEnabled, blocklistEnabled] = await Promise.all([
      this.getBooleanConfig(
        BOT_PERMISSION_CONFIG_KEYS.allowlistEnabled,
        false,
      ),
      this.getBooleanConfig(
        BOT_PERMISSION_CONFIG_KEYS.blocklistEnabled,
        true,
      ),
    ]);

    return { allowlistEnabled, blocklistEnabled };
  }

  /**
   * 读取配置值；通过 `configRepository.findOne` 查询匹配的持久化记录。
   * @param configKey - 要读取的 Bot 持久化配置自然键。
   * @returns 返回 `record?.configValue` 的可用值；为空时回退到 `undefined`；未提供结果时为 `undefined`，可选链未命中时为 `undefined`。
   */
  async getConfigValue(configKey: string): Promise<string | undefined> {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    return record?.configValue ?? undefined;
  }

  /**
   * 根据`config`更新权限配置；从 `getPermissionConfig` 读取权限配置。
   * @param config - 限定权限配置边界、地址与开关的运行配置，包含 `allowlistEnabled`、`blocklistEnabled` 字段。
   * @returns 权限配置。
   */
  async updatePermissionConfig(
    config: Partial<BotPermissionConfig>,
  ): Promise<BotPermissionConfig> {
    const tasks: Array<Promise<void>> = [];

    if (typeof config.allowlistEnabled === 'boolean') {
      tasks.push(
        this.setBooleanConfig(
          BOT_PERMISSION_CONFIG_KEYS.allowlistEnabled,
          config.allowlistEnabled,
          'Bot 白名单总开关',
        ),
      );
    }
    if (typeof config.blocklistEnabled === 'boolean') {
      tasks.push(
        this.setBooleanConfig(
          BOT_PERMISSION_CONFIG_KEYS.blocklistEnabled,
          config.blocklistEnabled,
          'Bot 黑名单总开关',
        ),
      );
    }

    await Promise.all(tasks);
    return this.getPermissionConfig();
  }

  /**
   * 按`configKey`、`defaultValue`读取布尔值配置；从 `configRepository.findOne` 读取布尔值配置。
   * @param configKey - 用于读取或更新布尔值配置的稳定键。
   * @param defaultValue - 主值缺失、为空或不合法时采用的兜底结果。
   * @returns 满足布尔值配置约束时为 `true`；不满足、未命中或显式失败分支为 `false`。
   */
  async getBooleanConfig(configKey: string, defaultValue: boolean) {
    const record = await this.configRepository.findOne({
      where: { configKey },
    });
    if (!record) return defaultValue;
    return record.configValue === 'true';
  }

  /**
   * 根据`configKey`、`value`、`remark`更新布尔值配置；当 `exists` 成立时直接结束且不产生返回值。
   * @param configKey - 用于读取或更新布尔值配置的稳定键。
   * @param value - 参与布尔值配置比较、格式化或输出的候选值。
   * @param remark - 决定布尔值配置内容、边界或目标的 `remark` 值。
   */
  async setBooleanConfig(configKey: string, value: boolean, remark: string) {
    const exists = await this.configRepository.findOne({
      where: { configKey },
    });
    const configValue = (() => {
      if (value) {
        return 'true';
      }
      return 'false';
    })();

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

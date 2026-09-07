import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { BotConfig } from '../../infrastructure/persistence/config/bot-config.entity';
import type { BotPermissionConfig } from '../../contract/bot.types';

@Injectable()
export class BotConfigService {
  constructor(
    @InjectRepository(BotConfig)
    private readonly configRepository: Repository<BotConfig>,
  ) {}

  /**
   * 返回固定同时启用的黑白名单策略，历史互斥开关不再改变实际过滤行为。
   * @returns 黑名单和白名单均启用的权限配置。
   */
  async getPermissionConfig(): Promise<BotPermissionConfig> {
    return { allowlistEnabled: true, blocklistEnabled: true };
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
   * 保持旧配置接口可读取双名单策略，拒绝旧客户端重新关闭任一名单。
   * @param config - 旧客户端提交的名单开关；仅允许空值或启用。
   * @returns 固定同时启用的权限配置。
   * @throws 请求关闭任一名单时返回业务错误。
   */
  async updatePermissionConfig(
    config: Partial<BotPermissionConfig>,
  ): Promise<BotPermissionConfig> {
    if (
      config.allowlistEnabled === false ||
      config.blocklistEnabled === false
    ) {
      throwVbenError('黑白名单同时生效，不能关闭；请管理具体名单项');
    }
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

import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { throwVbenError } from '@/common';
import { BotAccount } from '../../infrastructure/persistence/account/bot-account.entity';
import { BotMessage } from '../../infrastructure/persistence/message/bot-message.entity';
import { BotReverseWsService } from '../../infrastructure/integration/connection/bot-reverse-ws.service';
import type { BotPermissionOptionsQueryDto } from '../../contract/permission/bot-permission.dto';

type PermissionOption = { label: string; value: string };

@Injectable()
export class BotPermissionOptionsService {
  constructor(
    @InjectRepository(BotAccount)
    private readonly accounts: Repository<BotAccount>,
    @InjectRepository(BotMessage)
    private readonly messages: Repository<BotMessage>,
    private readonly reverseWs: BotReverseWsService,
  ) {}

  /**
   * 列出全部未删除 Bot 账号，再按精确账号与会话读取目标及成员；官方账号只使用已接收事件中的 OpenID。
   * @param query - 当前账号、目标类型和可选群或频道标识。
   * @returns 账号下拉、隔离后的目标和用户候选，以及候选来源和读取提示。
   * @throws 账号不存在或目标类型非法时拒绝读取。
   */
  async list(query: BotPermissionOptionsQueryDto) {
    const accounts = await this.accounts.find({
      where: { isDeleted: false },
      order: { createTime: 'ASC' },
      select: ['selfId', 'name', 'connectionMode', 'enabled'],
    });
    const result = {
      accounts: accounts.map((account) => ({
        connectionMode: account.connectionMode,
        enabled: account.enabled,
        label: `${account.name || account.selfId} (${account.selfId})`,
        value: account.selfId,
      })),
      targets: [] as PermissionOption[],
      users: [] as PermissionOption[],
      source: 'observed' as 'live' | 'observed',
      notice: '',
    };
    if (!query.selfId) return result;
    const account = accounts.find((item) => item.selfId === query.selfId);
    if (!account) throwVbenError('请选择有效的 Bot 账号');
    const targetType = query.targetType || 'qq';
    if (!['qq', 'group', 'channel'].includes(targetType))
      throwVbenError('名单目标类型无效');
    if (account.connectionMode === 'reverse-ws' && targetType !== 'channel') {
      try {
        let action = 'get_friend_list';
        if (targetType === 'group') action = 'get_group_list';
        result.targets = await this.liveOptions(account.selfId, action, {});
        if (targetType === 'group' && query.targetId) {
          if (!result.targets.some((item) => item.value === query.targetId))
            throwVbenError('所选群聊不属于当前账号');
          result.users = await this.liveOptions(
            account.selfId,
            'get_group_member_list',
            { group_id: query.targetId },
          );
        }
        result.source = 'live';
        return result;
      } catch {
        result.notice = '实时列表不可用，以下为此账号已接收消息中的目标';
      }
    } else {
      result.notice = '以下为此账号已接收消息中的目标与用户';
    }
    result.targets = await this.observedOptions(account.selfId, targetType);
    result.users = [];
    if (
      targetType !== 'qq' &&
      query.targetId &&
      result.targets.some((item) => item.value === query.targetId)
    ) {
      result.users = await this.observedOptions(
        account.selfId,
        targetType,
        query.targetId,
      );
    }
    return result;
  }

  /**
   * 通过选定 NapCat 账号读取好友、群或群成员并校验响应，不发送聊天消息。
   * @param selfId - 发起 OneBot 查询的唯一账号。
   * @param action - 好友列表、群列表或群成员列表动作。
   * @param params - 已验证归属的群标识，或空查询参数。
   * @returns 带名称和数字标识的去重候选。
   * @throws OneBot 失败或返回格式不符合列表合同时抛出错误。
   */
  private async liveOptions(
    selfId: string,
    action: string,
    params: Record<string, unknown>,
  ) {
    const response = await this.reverseWs.sendAction(selfId, action, params);
    if (
      response.status !== 'ok' ||
      (response.retcode !== undefined && response.retcode !== 0) ||
      !Array.isArray(response.data)
    )
      throw new Error('Bot 列表读取失败');
    const options: PermissionOption[] = [];
    for (const item of response.data) {
      let value = `${item.user_id || ''}`;
      let name = item.card || item.remark || item.nickname || '';
      if (action === 'get_group_list') {
        value = `${item.group_id || ''}`;
        name = item.group_name || '';
      }
      if (!/^[1-9]\d{4,19}$/u.test(value)) continue;
      let label = value;
      if (name) label = `${name} (${value})`;
      options.push({ label, value });
    }
    return [...new Map(options.map((item) => [item.value, item])).values()];
  }

  /**
   * 从入站消息按账号及会话聚合已知目标；私聊名单聚合用户，精确模式仅返回所选群或频道的发言者。
   * @param selfId - 不允许跨越的 Bot 账号身份。
   * @param targetType - QQ 用户、群或频道名单类型。
   * @param targetId - 可选的精确群或频道标识；提供时改为查询该会话成员。
   * @returns 不含消息正文与原始事件的候选项。
   */
  private async observedOptions(
    selfId: string,
    targetType: string,
    targetId?: string,
  ): Promise<PermissionOption[]> {
    let field = 'message.targetId';
    if (targetType === 'qq' || targetId) field = 'message.userId';
    const query = this.messages
      .createQueryBuilder('message')
      .select(field, 'value')
      .where('message.selfId = :selfId', { selfId })
      .andWhere('message.direction = :direction', { direction: 'inbound' });
    if (targetType !== 'qq')
      query.andWhere('message.messageType = :targetType', { targetType });
    if (targetId) query.andWhere('message.targetId = :targetId', { targetId });
    if (field === 'message.userId')
      query.addSelect('MAX(message.senderNickname)', 'name');
    const rows = await query
      .groupBy(field)
      .orderBy(field, 'ASC')
      .getRawMany<{ name?: string; value: string }>();
    return rows
      .filter((row) => !!row.value)
      .map((row) => {
        let label = row.value;
        if (row.name) label = `${row.name} (${row.value})`;
        return { label, value: row.value };
      });
  }
}

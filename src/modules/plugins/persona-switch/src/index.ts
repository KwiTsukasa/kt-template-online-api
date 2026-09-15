import type {
  PluginStateSnapshot,
  PluginStateWrite,
} from '@/modules/plugin-platform/contract/plugin-state';
import { synchronizeSoul, type RequestResponse } from './hermes-soul';
import { parsePersonaCommand, PERSONA_HELP } from './command';
import { callProfileExecutor } from './profile-client';
import {
  readState,
  savePersona,
  selectPersona,
  confirmSelections,
  compactVersions,
  soulProjection,
  type PersonaState,
} from './state';

type Options = {
  host: Record<string, unknown>;
  manifest: {
    pluginKey: string;
    name: string;
    version: string;
    description?: string;
    operations: Array<{ key: string; handlerName: string; name: string }>;
  };
  runtime: { configSnapshot: Record<string, string | undefined> };
};

/**
 * 将显式图文命令与未完成任务恢复交给同一 API 状态机，普通聊天不修改人格。
 * @param options - 插件身份、私有配置与受控宿主能力。
 * @returns 通用插件工作线程可加载的管理实例。
 * @throws 清单引用未实现操作时拒绝加载。
 */
export function createPlugin(options: Options) {
  const application = new PersonaApplication(options);
  return {
    key: options.manifest.pluginKey,
    name: options.manifest.name,
    version: options.manifest.version,
    description: options.manifest.description,
    activate: () => application.restore(true),
    tasks: [{ key: 'persona.reconcile', execute: () => application.restore() }],
    operations: options.manifest.operations.map((operation) => {
      if (operation.handlerName !== 'managePersona')
        throw new Error('人格操作未实现');
      return {
        ...operation,
        execute: (
          input: Record<string, unknown>,
          context?: Record<string, unknown>,
        ) => application.manage(input, context),
      };
    }),
  };
}

class PersonaApplication {
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
  }

  /**
   * 读取并校验本插件的持久快照，不向请求方提供其他插件数据。
   * @returns 独立状态副本及其乐观并发版本。
   * @throws 状态能力缺失或版本损坏时停止操作。
   */
  private async read() {
    const read = this.options.host.readPluginState;
    if (typeof read !== 'function') throw new Error('人格状态存储未就绪。');
    const snapshot = (await read()) as PluginStateSnapshot;
    if (
      !snapshot ||
      !Number.isSafeInteger(snapshot.revision) ||
      snapshot.revision < 0
    )
      throw new Error('人格状态版本无效。');
    return { revision: snapshot.revision, state: readState(snapshot.value) };
  }

  /**
   * 条件保存 API 状态，阻止多个线程覆盖同一共享人格选择。
   * @param revision - 本轮读取的预期版本。
   * @param state - 待保存的完整人格状态。
   * @returns 持久化后的新版本号。
   * @throws 缺少条件写能力或并发冲突时拒绝确认。
   */
  private async write(revision: number, state: PersonaState) {
    const write = this.options.host.compareAndSwapPluginState;
    if (typeof write !== 'function') throw new Error('人格状态存储未就绪。');
    const snapshot = (await write({
      expectedRevision: revision,
      value: state,
    } satisfies PluginStateWrite)) as PluginStateSnapshot;
    return snapshot.revision;
  }

  /**
   * 取得由宿主限制大小和超时的 HTTP 通道。
   * @returns 已绑定插件身份的请求能力。
   * @throws 网络能力尚未接线时停止外部操作。
   */
  private request(): RequestResponse {
    const request = this.options.host.requestResponse;
    if (typeof request !== 'function') throw new Error('人格同步通道未就绪。');
    return request as RequestResponse;
  }

  /**
   * 下载第一张 QQ 附件并持久存入 NAS，只有得到内容摘要才允许保存人格。
   * @param imageUrl - 由宿主真实附件投影取得的第一张图片地址。
   * @returns NAS 已验证并保存的头像内容标识。
   * @throws 非 QQ 图片域、下载或持久化失败时不保存人格。
   */
  private async saveAvatar(imageUrl: string) {
    const url = new URL(imageUrl);
    if (
      url.hostname !== 'multimedia.nt.qq.com' &&
      url.hostname !== 'multimedia.nt.qq.com.cn' &&
      !url.hostname.endsWith('.qpic.cn')
    )
      throw new Error('头像必须来自本条 QQ 图片附件。');
    const downloaded = await this.request()({
      url: imageUrl,
      method: 'GET',
      timeoutMs: 8000,
      maxResponseBytes: 2 * 1024 * 1024,
      context: '人格头像读取',
    });
    if (downloaded.statusCode !== 200) throw new Error('头像读取失败。');
    const saved = await callProfileExecutor(
      this.options.runtime.configSnapshot,
      this.request(),
      '/v1/avatars',
      { image: Buffer.from(downloaded.body).toString('base64') },
    );
    if (typeof saved.hash !== 'string' || !/^[a-f0-9]{64}$/u.test(saved.hash))
      throw new Error('头像持久化未确认。');
    return { hash: saved.hash };
  }

  /**
   * 在版本竞争时重新读取并重放本次窄变更，避免不同群的选择相互覆盖。
   * @param change - 只修改本轮目标的纯状态变换。
   * @returns 已持久化状态及其宿主版本。
   * @throws 非并发错误或连续竞争超限时保留既有状态并报告失败。
   */
  private async update(change: (state: PersonaState) => PersonaState) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const snapshot = await this.read();
      const state = change(snapshot.state);
      try {
        const revision = await this.write(snapshot.revision, state);
        return { revision, state };
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('版本冲突'))
          throw error;
      }
    }
    throw new Error('人格状态竞争繁忙，请重试。');
  }

  /**
   * 发布 API 的完整期望映射并核对摘要；较新切换到达时重读，不用旧快照覆盖确认值。
   * @returns 已读回确认的状态。
   * @throws 网络、核验失败或持续并发更新时保留期望状态供后续恢复。
   */
  private async synchronize(): Promise<PersonaState> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { state } = await this.read();
      try {
        await synchronizeSoul(
          this.options.runtime.configSnapshot,
          this.request(),
          soulProjection(state),
        );
      } catch (error) {
        const latest = await this.read();
        if (latest.state.soulRevision > state.soulRevision) continue;
        throw error;
      }
      const confirmed = await this.update((latest) => {
        if (latest.soulRevision !== state.soulRevision) return latest;
        return confirmSelections(latest);
      });
      if (confirmed.state.publishedRevision === confirmed.state.soulRevision)
        return confirmed.state;
    }
    throw new Error('人格映射仍在更新，请稍后查看当前会话。');
  }

  /**
   * 比对期望修订与已发布修订；启动时读回 NAS 清单，后续仅补交未确认的映射。
   * @param startup - 是否核对已经发布过的清单。
   * @returns 本轮是否完成持久状态的同步检查。
   */
  async restore(startup = false) {
    try {
      const { revision, state } = await this.read();
      if (revision === 0) return { synchronized: false };
      if (startup || state.publishedRevision !== state.soulRevision)
        await this.synchronize();
      return { synchronized: true };
    } catch {
      return { synchronized: false };
    }
  }

  /**
   * 从宿主独立上下文取得会话标识，正文和命令参数不能指定或冒充其他会话。
   * @param context - 经过适配器归一化的命令执行上下文。
   * @returns 当前群、频道或私聊的稳定摘要，缺失时返回空值。
   */
  private scope(context?: Record<string, unknown>): string | undefined {
    const conversation = context?.conversation as
      | { key?: unknown; scope?: unknown }
      | undefined;
    if (
      typeof conversation?.key !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(conversation.key) ||
      !['group', 'direct', 'channel'].includes(String(conversation.scope))
    )
      return undefined;
    return conversation.key;
  }

  /**
   * 管理共享目录并只切换命令所在会话的选择，展示该会话的确认值与待同步值。
   * @param input - 保留换行的命令正文与第一张图片附件。
   * @param context - 与用户输入隔离的真实会话上下文。
   * @returns 经现有回复队列发送的命令结果。
   */
  async manage(
    input: Record<string, unknown>,
    context?: Record<string, unknown>,
  ) {
    const command = parsePersonaCommand(input);
    if (!command) return { replyText: PERSONA_HELP };
    const scope = this.scope(context);
    try {
      const { state } = await this.read();
      if (command.action === 'help') {
        const names =
          state.profiles
            .filter((item) => item.avatar)
            .map((item) => item.name)
            .join('、') || '暂无';
        let text = PERSONA_HELP + '\n\n已保存：' + names;
        if (scope) {
          const binding = state.bindings[scope];
          text +=
            '\n当前会话人格：' +
            state.versions[binding?.current || state.fallback].name;
          if (binding && binding.current !== binding.desired)
            text += '\n人格待同步：' + state.versions[binding.desired].name;
        } else text += '\n请在目标群或私聊中查看当前人格。';
        return { replyText: text };
      }
      if (command.action === 'save') {
        const avatar = await this.saveAvatar(command.imageUrl);
        await this.update((latest) =>
          savePersona(latest, command.name, command.content, avatar),
        );
        return {
          replyText:
            '已保存 ' +
            command.name +
            ' 的正文与头像。使用 /persona c ' +
            command.name +
            ' 切换当前会话。',
        };
      }
      const target = state.profiles.find(
        (item) => item.name === command.name && item.avatar,
      );
      if (!target)
        return {
          replyText:
            '没有找到完整的人格：' + command.name + '。\n' + PERSONA_HELP,
        };
      if (command.action === 'delete') {
        await this.update((latest) => {
          const used = [
            latest.fallback,
            ...Object.values(latest.bindings).flatMap((binding) => [
              binding.current,
              binding.desired,
            ]),
          ];
          if (used.some((id) => latest.versions[id].name === target.name))
            throw new Error('该人格仍被某个会话使用或同步，暂不能删除。');
          latest.profiles = latest.profiles.filter(
            (item) => item.name !== target.name,
          );
          for (const binding of Object.values(latest.bindings)) {
            if (
              binding.previous &&
              latest.versions[binding.previous].name === target.name
            )
              binding.previous = null;
          }
          return compactVersions(latest);
        });
        return {
          replyText: '已删除人格：' + target.name + '。共享记忆与对话保留。',
        };
      }
      if (!scope)
        return {
          replyText: '缺少可信会话身份，请在目标群或私聊中发送切换命令。',
        };
      await this.update((latest) => {
        const selected = latest.profiles.find(
          (item) => item.name === target.name && item.avatar,
        );
        if (!selected) throw new Error('人格已被删除，请重新查看目录。');
        return selectPersona(latest, scope, selected);
      });
      const next = await this.synchronize();
      return {
        replyText:
          '当前会话人格已选择：' +
          next.versions[next.bindings[scope].current].name +
          '。仅本群或本私聊生效；对话和记忆保留，Bot 昵称和头像不变。',
      };
    } catch (error) {
      if (command.action === 'save')
        return {
          replyText:
            '保存未成功，请检查图文格式及图片能否读取后重发。\n' + PERSONA_HELP,
        };
      if (
        command.action === 'delete' &&
        error instanceof Error &&
        error.message.includes('仍被某个会话')
      )
        return { replyText: error.message };
      return {
        replyText:
          '人格操作未确认成功，请在当前会话用 /persona h 查看；系统会恢复待同步选择。',
      };
    }
  }
}

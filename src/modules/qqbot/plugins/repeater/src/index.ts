import { RepeaterApplication } from './application/repeater-application';
import type { RepeaterManifest } from './domain/repeater.types';
import { createRepeaterMessageEventHandler } from './events/message';
import type { RepeaterPluginHost } from './infrastructure/integration/repeater-host';

type RepeaterPluginOptions = {
  host: RepeaterPluginHost;
  manifest: RepeaterManifest;
  now?: () => number;
};

/**
 * 创建 复读插件对象或配置。
 * @param options - 模块列表；使用 `host`、`manifest`、`now` 字段生成结果。
 */
export function createPlugin(options: RepeaterPluginOptions) {
  const application = new RepeaterApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createRepeaterMessageEventHandler(application);

  return {
    /**
     * 维护 模块事件绑定。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    bind: (selfId: string) => application.bind(selfId),
    /**
     * 执行 模块回调。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    clearBoundCache: (selfId: string) => application.clearBoundCache(selfId),
    /**
     * 读取 模块回调数据。
     */
    getDefinition: () => application.getDefinition(),
    /**
     * 读取 模块回调数据。
     * @param params - 模块列表；驱动 `application.getSummary()` 的 模块步骤。
     */
    getSummary: (params: {
      accountName?: string;
      connectStatus?: string;
      selfId: string;
    }) => application.getSummary(params),
    handleMessage,
    /**
     * 维护 模块事件绑定。
     * @param selfId - 账号 ID；定位本次读取、更新、删除或关联的账号。
     */
    unbind: (selfId: string) => application.unbind(selfId),
  };
}

import { RepeaterApplication } from './application/repeater-application';
import type { RepeaterManifest } from './domain/repeater.types';
import { createRepeaterMessageEventHandler } from './events/message';
import type { RepeaterPluginHost } from './infrastructure/integration/repeater-host';

export type RepeaterPluginOptions = {
  host: RepeaterPluginHost;
  manifest: RepeaterManifest;
  now?: () => number;
};

export function createPlugin(options: RepeaterPluginOptions) {
  const application = new RepeaterApplication(
    options.host,
    options.manifest,
    options.now,
  );
  const handleMessage = createRepeaterMessageEventHandler(application);

  return {
    bind: (selfId: string) => application.bind(selfId),
    clearBoundCache: (selfId: string) => application.clearBoundCache(selfId),
    getDefinition: () => application.getDefinition(),
    getSummary: (params: {
      accountName?: string;
      connectStatus?: string;
      selfId: string;
    }) => application.getSummary(params),
    handleMessage,
    unbind: (selfId: string) => application.unbind(selfId),
  };
}

export type { RepeaterPluginHost } from './infrastructure/integration/repeater-host';
export type { RepeaterManifest, RepeaterMessage } from './domain/repeater.types';

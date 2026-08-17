import { Injectable } from '@nestjs/common';
import { ToolsService } from '@/common';
import { stableJsonHash } from '../../domain/runtime/napcat-config-hash';
import type { NapcatConfigFile } from '../../domain/runtime/napcat-profile.types';

type OnebotReverseWsClientConfig = {
  debug: false;
  enable: true;
  heartInterval: 30000;
  messagePostFormat: 'array';
  name: 'kt-template-online-api-reverse';
  reconnectInterval: 5000;
  reportSelfMessage: false;
  token: '';
  url: string;
};

type OnebotConfig = {
  enableLocalFile2Url: false;
  musicSignUrl: '';
  network: {
    httpClients: [];
    httpServers: [];
    websocketClients: OnebotReverseWsClientConfig[];
    websocketServers: [];
  };
  parseMultMsg: false;
};

type NapcatConfig = {
  bypass: {
    container: true;
    hook: true;
    js: true;
    module: true;
    process: true;
    window: true;
  };
  o3HookMode: 0;
  packetBackend: 'auto';
  packetServer: '';
};

@Injectable()
export class NapcatConfigWriterService {
  constructor(private readonly toolsService: ToolsService) {}

  /** 构建配置文件。 */
  buildConfigFiles(input: {
    account?: string;
    reverseWsUrl: string;
    token: string;
  }) {
    const account = this.toolsService.toTrimmedString(input.account);
    const webuiConfig = {
      host: '0.0.0.0',
      loginRate: 3,
      port: 6099,
      token: input.token,
    };
    const napcatConfig: NapcatConfig = {
      bypass: {
        container: true,
        hook: true,
        js: true,
        module: true,
        process: true,
        window: true,
      },
      o3HookMode: 0,
      packetBackend: 'auto',
      packetServer: '',
    };
    const onebotConfig: OnebotConfig = {
      enableLocalFile2Url: false,
      musicSignUrl: '',
      network: {
        httpClients: [],
        httpServers: [],
        websocketClients: [
          {
            debug: false,
            enable: true,
            heartInterval: 30000,
            messagePostFormat: 'array',
            name: 'kt-template-online-api-reverse',
            reconnectInterval: 5000,
            reportSelfMessage: false,
            token: '',
            url: input.reverseWsUrl,
          },
        ],
        websocketServers: [],
      },
      parseMultMsg: false,
    };
    const files: NapcatConfigFile[] = [
      { content: this.stringify(webuiConfig), path: 'webui.json' },
      { content: this.stringify(napcatConfig), path: 'napcat.json' },
      { content: this.stringify(onebotConfig), path: 'onebot11.json' },
    ];

    if (account) {
      files.push(
        {
          content: this.stringify(napcatConfig),
          path: `napcat_${account}.json`,
        },
        {
          content: this.stringify(onebotConfig),
          path: `onebot11_${account}.json`,
        },
      );
    }

    return {
      files,
      napcatConfig,
      napcatConfigHash: stableJsonHash(napcatConfig),
      onebotConfig,
      onebotConfigHash: stableJsonHash(onebotConfig),
    };
  }

  /** 返回序列化。 */
  private stringify(value: Record<string, unknown>) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
}

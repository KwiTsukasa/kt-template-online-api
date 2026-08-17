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

  /**
   * 根据`input`构造配置文件。
   * @param input - 用于配置文件的结构化输入，包含 `account`、`token`、`reverseWsUrl` 字段。
   * @returns 包含 `files`、`napcatConfig`、`napcatConfigHash`、`onebotConfig`、`onebotConfigHash` 字段的配置文件。
   */
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

  /**
   * 按传输协议规则序列化。
   * @param value - 参与按传输协议规则序列化比较、格式化或输出的候选值。
   * @returns 按参数编码并拼接完成的按传输协议规则序列化；无法解析或未命中时为 `null`。
   */
  private stringify(value: Record<string, unknown>) {
    return `${JSON.stringify(value, null, 2)}\n`;
  }
}

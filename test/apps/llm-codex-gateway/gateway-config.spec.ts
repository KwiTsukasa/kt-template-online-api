import { ConfigService } from '@nestjs/config';
import { LlmCodexGatewayConfigService } from '../../../src/apps/llm-codex-gateway/config/llm-codex-gateway-config.service';

describe('LlmCodexGatewayConfigService', () => {
  it('accepts only the pinned NAS-local k3d bridge address', () => {
    const config = new LlmCodexGatewayConfigService(
      new ConfigService({ LLM_CODEX_GATEWAY_HOST: '172.21.0.1' }),
    );
    expect(config.host()).toBe('172.21.0.1');
  });

  it.each(['0.0.0.0', '172.21.0.9', '192.168.31.224'])(
    'rejects broader gateway bind %s',
    (host) => {
      const config = new LlmCodexGatewayConfigService(
        new ConfigService({ LLM_CODEX_GATEWAY_HOST: host }),
      );
      expect(() => config.host()).toThrow('llm-codex-gateway-host-invalid');
    },
  );

  it('uses the dedicated LLM gateway secret', () => {
    const config = new LlmCodexGatewayConfigService(
      new ConfigService({
        LLM_CODEX_GATEWAY_INTERNAL_SECRET: 'l'.repeat(32),
      }),
    );
    expect(config.llmInternalSecret()).toBe('l'.repeat(32));
  });
});

import { ConfigService } from '@nestjs/config';
import { MediaCodexAgentGatewayConfigService } from '../../../src/apps/media-codex-agent-gateway/config/media-codex-agent-gateway-config.service';

describe('MediaCodexAgentGatewayConfigService', () => {
  it('accepts only the pinned NAS-local k3d bridge address', () => {
    const config = new MediaCodexAgentGatewayConfigService(
      new ConfigService({ MEDIA_CODEX_AGENT_HOST: '172.21.0.1' }),
    );
    expect(config.host()).toBe('172.21.0.1');
  });

  it.each(['0.0.0.0', '172.21.0.9', '192.168.31.224'])(
    'rejects broader gateway bind %s',
    (host) => {
      const config = new MediaCodexAgentGatewayConfigService(
        new ConfigService({ MEDIA_CODEX_AGENT_HOST: host }),
      );
      expect(() => config.host()).toThrow('media-codex-agent-host-invalid');
    },
  );

  it('uses one LLM secret for generic chat and media governance', () => {
    const config = new MediaCodexAgentGatewayConfigService(
      new ConfigService({
        LLM_CODEX_GATEWAY_INTERNAL_SECRET: 'l'.repeat(32),
        MEDIA_CODEX_AGENT_INTERNAL_SECRET: 'm'.repeat(32),
      }),
    );
    expect(config.llmInternalSecret()).toBe('l'.repeat(32));
    expect(config.internalSecret()).toBe('l'.repeat(32));
  });

  it('does not revive the retired media-only secret', () => {
    const config = new MediaCodexAgentGatewayConfigService(
      new ConfigService({
        MEDIA_CODEX_AGENT_INTERNAL_SECRET: 'm'.repeat(32),
      }),
    );
    expect(() => config.llmInternalSecret()).toThrow(
      'llm-codex-gateway-internal-secret-invalid',
    );
  });
});

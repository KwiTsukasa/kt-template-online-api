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
});

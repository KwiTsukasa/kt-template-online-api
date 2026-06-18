import axios from 'axios';
import { EnvironmentReadonlyHttpClient } from '../../../../src/modules/admin/platform-config/environment-dashboard/infrastructure/adapters/environment-readonly-http.client';

jest.mock('axios');

const requestMock = axios.request as jest.Mock;

describe('environment readonly http client', () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it('allows GET requests and truncates large response bodies', async () => {
    requestMock.mockResolvedValue({
      data: 'x'.repeat(128),
      headers: { 'content-type': 'text/plain' },
      status: 200,
      statusText: 'OK',
    });

    const client = new EnvironmentReadonlyHttpClient({
      bodyPreviewLimit: 16,
      timeoutMs: 3000,
    });
    const result = await client.get('https://example.test/health', {
      headers: { Authorization: 'Bearer secret-token' },
    });

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'GET',
        timeout: 3000,
        url: 'https://example.test/health',
      }),
    );
    expect(result.bodyPreview).toBe('xxxxxxxxxxxxxxxx...');
    expect(JSON.stringify(result)).not.toContain('secret-token');
  });

  it('allows HEAD requests without storing a body preview', async () => {
    requestMock.mockResolvedValue({
      data: '',
      headers: { server: 'caddy' },
      status: 200,
      statusText: 'OK',
    });

    const client = new EnvironmentReadonlyHttpClient({ timeoutMs: 3000 });
    const result = await client.head('https://example.test');

    expect(requestMock).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'HEAD' }),
    );
    expect(result.bodyPreview).toBe('');
  });

  it('rejects write methods at the client boundary', async () => {
    const client = new EnvironmentReadonlyHttpClient({ timeoutMs: 3000 });

    await expect(
      client.request('POST', 'https://example.test/mutate'),
    ).rejects.toThrow('只允许 GET/HEAD');
    expect(requestMock).not.toHaveBeenCalled();
  });
});

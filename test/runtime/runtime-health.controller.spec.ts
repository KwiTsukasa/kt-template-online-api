import { RuntimeHealthController } from '../../src/runtime/health/runtime-health.controller';
import type { RuntimeHealthReport } from '../../src/runtime/health/runtime-health.types';

describe('RuntimeHealthController', () => {
  it('returns the service report and calls the service once', () => {
    const report: RuntimeHealthReport = {
      service: 'kt-template-online-api',
      checkedAt: '2026-06-13T00:00:00.000Z',
      status: 'ready',
      checks: [],
    };
    const service = { getRuntimeHealth: jest.fn(() => report) };
    const controller = new RuntimeHealthController(service as any);

    expect(controller.getRuntimeHealth()).toBe(report);
    expect(service.getRuntimeHealth).toHaveBeenCalledTimes(1);
  });
});

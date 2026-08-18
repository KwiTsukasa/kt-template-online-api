import { firstValueFrom, filter } from 'rxjs';
import { AdminNoticeEventStreamService } from '@/modules/admin/platform-config/notice/admin-notice-event-stream.service';

describe('AdminNoticeEventStreamService', () => {
  it('asks a first-time client to load the current snapshot', async () => {
    const service = new AdminNoticeEventStreamService({ heartbeatMs: 60_000 });

    await expect(firstValueFrom(service.stream())).resolves.toMatchObject({
      type: 'snapshot-required',
    });
  });

  it('pushes committed changes and replays events after the client cursor', async () => {
    const service = new AdminNoticeEventStreamService({ heartbeatMs: 60_000 });
    const liveEvent = firstValueFrom(
      service.stream().pipe(filter((event) => event.type === 'notice-changed')),
    );

    const first = service.publishCommitted('created');
    await expect(liveEvent).resolves.toEqual(first);

    const second = service.publishCommitted('read');
    await expect(firstValueFrom(service.stream(first.id))).resolves.toEqual(
      second,
    );
  });
});

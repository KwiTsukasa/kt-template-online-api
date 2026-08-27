import type { DataSource, EntityManager } from 'typeorm';
import { MediaGovernanceCatalogService } from '../../../src/modules/admin/media-governance/application/media-governance-catalog.service';
import { MediaGovernanceEventStreamService } from '../../../src/modules/admin/media-governance/application/media-governance-event-stream.service';
import type { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';

type DeleteFixture = {
  revision?: number;
  taskRows?: Array<{ id: string }>;
};

/**
 * 构造只响应 Series 空壳删除 SQL 的事务替身，并保留全部查询供顺序与写边界断言。
 *
 * @param fixture - 可覆盖 revision 或注入 Task 阻断行的测试事实。
 * @returns 目录服务、事件流与原始 SQL 查询桩。
 */
function createDeleteService(fixture: DeleteFixture = {}) {
  const query = jest.fn(async (sql: string) => {
    const normalized = sql.replaceAll(/\s+/gu, ' ').trim();
    if (
      normalized.startsWith('SELECT id, revision') &&
      normalized.includes('FROM media_governance_series')
    ) {
      return [
        {
          id: 'media-series-empty',
          revision: fixture.revision ?? 1,
        },
      ];
    }
    if (
      normalized.startsWith('SELECT id') &&
      normalized.includes('FROM media_governance_work') &&
      !normalized.includes('external_ref')
    ) {
      return [{ id: 'media-work-empty' }];
    }
    if (
      normalized.startsWith('SELECT id') &&
      normalized.includes('FROM media_governance_work_external_ref')
    ) {
      return [{ id: 'media-work-ref-empty' }];
    }
    if (
      normalized.startsWith('SELECT id') &&
      normalized.includes('FROM media_governance_task')
    ) {
      return fixture.taskRows ?? [];
    }
    if (normalized.startsWith('SELECT id')) return [];
    if (normalized.startsWith('DELETE')) return { affectedRows: 1 };
    throw new Error(`unexpected SQL: ${normalized}`);
  });
  const manager = { query } as unknown as EntityManager;
  const dataSource = {
    transaction: jest.fn(async (callback) => callback(manager)),
  } as unknown as DataSource;
  const eventStream = new MediaGovernanceEventStreamService({
    heartbeatMs: 60_000,
  });
  const service = new MediaGovernanceCatalogService(
    dataSource,
    {} as MediaGovernanceService,
    eventStream,
  );
  return { eventStream, query, service };
}

describe('MediaGovernanceCatalogService empty Series deletion', () => {
  it('locks every ownership range, deletes only identity shells and emits a tombstone', async () => {
    const { eventStream, query, service } = createDeleteService();
    const events: unknown[] = [];
    const subscription = eventStream.stream().subscribe((event) => {
      if (event.type === 'catalog-changed') events.push(event);
    });

    await expect(
      service.deleteEmptySeries('media-series-empty', 1),
    ).resolves.toEqual({
      deleted: true,
      revision: 2,
      seriesId: 'media-series-empty',
    });

    const sql = query.mock.calls.map(([statement]) =>
      String(statement).replaceAll(/\s+/gu, ' ').trim(),
    );
    expect(sql.filter((statement) => statement.endsWith('FOR UPDATE'))).toEqual(
      expect.arrayContaining([
        expect.stringContaining('FROM media_governance_series'),
        expect.stringContaining('FROM media_governance_work'),
        expect.stringContaining('FROM media_governance_task'),
        expect.stringContaining('FROM media_governance_season'),
        expect.stringContaining('FROM media_governance_episode'),
        expect.stringContaining('FROM media_governance_task_episode_binding'),
        expect.stringContaining('FROM media_governance_rss_subscription'),
      ]),
    );
    expect(sql.filter((statement) => statement.startsWith('DELETE'))).toEqual([
      expect.stringContaining('media_governance_work_external_ref'),
      expect.stringContaining('media_governance_work WHERE'),
      expect.stringContaining('media_governance_series WHERE'),
    ]);
    expect(events).toContainEqual(
      expect.objectContaining({
        data: expect.objectContaining({
          changeType: 'deleted',
          revision: 2,
          series: null,
          seriesId: 'media-series-empty',
        }),
        type: 'catalog-changed',
      }),
    );
    subscription.unsubscribe();
  });

  it('rejects a stale revision before any delete statement', async () => {
    const { query, service } = createDeleteService({ revision: 2 });

    await expect(
      service.deleteEmptySeries('media-series-empty', 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).trim().startsWith('DELETE'),
      ),
    ).toBe(false);
  });

  it('rejects a Series with any Task before deleting references', async () => {
    const { query, service } = createDeleteService({
      taskRows: [{ id: 'media-task-existing' }],
    });

    await expect(
      service.deleteEmptySeries('media-series-empty', 1),
    ).rejects.toMatchObject({ status: 409 });
    expect(
      query.mock.calls.some(([statement]) =>
        String(statement).trim().startsWith('DELETE'),
      ),
    ).toBe(false);
  });
});

import { MediaGovernanceService } from '../../../src/modules/admin/media-governance/application/media-governance.service';
import { MediaScrapeValidationService } from '../../../src/modules/admin/media-scrape-validation/application/media-scrape-validation.service';
import type { MediaScrapeValidationEntity } from '../../../src/modules/admin/media-scrape-validation/infrastructure/persistence/media-scrape-validation.entity';

describe('MediaScrapeValidationService', () => {
  /**
   * 构造只保存独立校验行的内存仓库和事务外壳。
   * @returns 服务、校验行集合和治理 Task 仓库写入监控。
   */
  function fixture() {
    const rows = new Map<string, MediaScrapeValidationEntity>();
    const validationRepository = {
      create: (value: MediaScrapeValidationEntity) => value,
      find: async () => [...rows.values()],
      findOne: async ({ where }: { where: { id?: string; status?: string } }) =>
        [...rows.values()].find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.status && row.status !== where.status) return false;
          return true;
        }) ?? null,
      findOneBy: async (where: { id?: string; taskId?: string }) =>
        [...rows.values()].find((row) => {
          if (where.id && row.id !== where.id) return false;
          if (where.taskId && row.taskId !== where.taskId) return false;
          return true;
        }) ?? null,
      save: async (entity: MediaScrapeValidationEntity) => {
        rows.set(entity.id, entity);
        return entity;
      },
    };
    const taskRepository = {
      find: jest.fn(async () => []),
      save: jest.fn(),
    };
    const unitRepository = { find: jest.fn(async () => []) };
    const dataSource = {
      transaction: async (
        work: (manager: {
          getRepository: () => typeof validationRepository;
        }) => Promise<unknown>,
      ) => work({ getRepository: () => validationRepository }),
    };
    const service = new MediaScrapeValidationService(
      dataSource as never,
      validationRepository as never,
      taskRepository as never,
      unitRepository as never,
    );
    return { rows, service, taskRepository };
  }

  it('creates one pending validation from a mechanically closed task', async () => {
    const { rows, service, taskRepository } = fixture();
    const governance = new MediaGovernanceService();
    const task = await governance.create({
      mediaType: 'movie',
      providerRef: { provider: 'tmdb', providerId: '1390384' },
      releaseYear: 2026,
      titleHint: '独立刮削校验测试',
    });
    task.closedAt = '2026-09-01T04:00:00.000Z';
    task.closedMode = 'mechanical';
    task.runState = 'succeeded';
    task.stage = 'closed';
    task.units[0]!.evidenceSha256 = 'a'.repeat(64);
    task.units[0]!.localAcceptedAt = task.closedAt;

    await service.enqueueTask(task);

    expect([...rows.values()]).toEqual([
      expect.objectContaining({
        governanceRevision: task.revision,
        status: 'pending',
        taskId: task.id,
      }),
    ]);
    expect(taskRepository.save).not.toHaveBeenCalled();
  });

  it('claims and completes an issue result without writing governance tasks', async () => {
    const { rows, service, taskRepository } = fixture();
    const governance = new MediaGovernanceService();
    const task = await governance.create({
      mediaType: 'tv',
      seasonNumbers: ['S01'],
      titleHint: '刮削缺项隔离测试',
    });
    task.closedAt = '2026-09-01T04:00:00.000Z';
    task.closedMode = 'mechanical';
    task.runState = 'succeeded';
    task.stage = 'closed';
    await service.enqueueTask(task);
    const claimed = await service.claimNext();

    const completed = await service.complete(claimed!.id, {
      evidenceSha256: 'b'.repeat(64),
      expectedRevision: claimed!.revision,
      issues: [
        {
          code: 'season-poster-missing',
          message: 'S01 缺少季海报',
          scope: 'S01',
          severity: 'warning',
        },
      ],
      status: 'issues',
      summary: '发现 1 个刮削缺项',
    });

    expect(completed).toMatchObject({
      issues: [expect.objectContaining({ code: 'season-poster-missing' })],
      status: 'issues',
      taskId: task.id,
    });
    expect(rows.get(claimed!.id)?.status).toBe('issues');
    expect(task.stage).toBe('closed');
    expect(taskRepository.save).not.toHaveBeenCalled();
  });

  it('requeues a completed validation by its own revision only', async () => {
    const { service } = fixture();
    const governance = new MediaGovernanceService();
    const task = await governance.create({
      mediaType: 'movie',
      titleHint: '独立重试版本测试',
    });
    task.closedAt = '2026-09-01T04:00:00.000Z';
    task.closedMode = 'mechanical';
    task.runState = 'succeeded';
    task.stage = 'closed';
    await service.enqueueTask(task);
    const page = await service.page({ pageNo: 1, pageSize: 20 });
    const record = page.items[0]!;

    const requeued = await service.requestRecheck(record.id, {
      expectedRevision: record.revision,
    });

    expect(requeued.status).toBe('pending');
    expect(requeued.revision).toBe(record.revision + 1);
    expect(task.stage).toBe('closed');
  });
});

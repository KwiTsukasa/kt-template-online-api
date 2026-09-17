import { Test } from '@nestjs/testing';
import type { INestApplication, ExecutionContext } from '@nestjs/common';
import { DataSource, type FindOperator } from 'typeorm';
import { ScheduleController } from '@/modules/task-scheduling/contract/schedule.controller';
import { ScheduleControlService } from '@/modules/task-scheduling/application/schedule-control.service';
import { ScheduleDispatchService } from '@/modules/task-scheduling/application/schedule-dispatch.service';
import { ScheduleDefinitionService } from '@/modules/task-scheduling/application/schedule-definition.service';
import { ScheduleDispatch, ScheduleRegistration, ScheduleState } from '@/modules/task-scheduling/infrastructure/persistence/schedule-plan.entities';
import { TriggerOccurrenceService } from '@/modules/trigger-engine/application/trigger-occurrence.service';
import { TriggerRegistration } from '@/modules/trigger-engine/infrastructure/persistence/trigger-runtime.entities';
import { JwtAuthGuard } from '@/modules/admin/identity/auth/presentation/jwt-auth.guard';

describe('计划分页批量运行投影与真实本地 HTTP', () => {
  let app: INestApplication;
  let base: string;
  let rows: { id: string; name: string }[];
  const stateRows = [
    Object.assign(new ScheduleState(), { scheduleId: '10', revision: 7, enabled: true, activeBindingId: '11', errorMessage: null }),
    Object.assign(new ScheduleState(), { scheduleId: '20', revision: 2, enabled: false, activeBindingId: '12', errorMessage: '已停用' }),
  ];
  const bindingRows = [
    Object.assign(new ScheduleRegistration(), { id: '11', scheduleId: '10', scheduleVersion: 3, registrationId: '101' }),
    Object.assign(new ScheduleRegistration(), { id: '12', scheduleId: '20', scheduleVersion: 1, registrationId: '102' }),
  ];
  const registrationRows = [
    Object.assign(new TriggerRegistration(), { id: '101', triggerId: '51', triggerVersion: 1, consumerKey: 'schedule-10', status: 'active', nextAt: new Date('2026-09-18T03:00:00Z') }),
    Object.assign(new TriggerRegistration(), { id: '102', triggerId: '52', triggerVersion: 2, consumerKey: 'schedule-20', status: 'closed', nextAt: new Date('2026-09-18T04:00:00Z') }),
  ];
  const dispatchRows = [Object.assign(new ScheduleDispatch(), {
    id: '2100670816722227200', scheduleId: '10', scheduleVersion: 3, occurrenceId: '1001',
    occurredAt: new Date('2026-09-18T02:00:00Z'), status: 'failed',
    definition: { target: { type: 'workflow', reference: { id: '88', version: 3 } } },
    targetRunId: '2100670816722227201', errorMessage: '业务拒绝', finishedAt: null,
  })];
  const stateRead = jest.fn(async (where: { scheduleId: FindOperator<string> }) => stateRows.filter((row) => where.scheduleId.value.includes(row.scheduleId)));
  const bindingRead = jest.fn(async (where: { id: FindOperator<string> }) => bindingRows.filter((row) => where.id.value.includes(row.id)));
  const registrationRead = jest.fn(async (where: { id: FindOperator<string> }) => registrationRows.filter((row) => where.id.value.includes(row.id)));
  const queries: [string, unknown[]][] = [];
  const resolveTrigger = jest.fn(async () => ({ trigger: { type: 'manual' } }));
  let control: ScheduleControlService;
  let triggers: TriggerOccurrenceService;

  beforeAll(async () => {
    const database = new DataSource({ type: 'mysql', database: 'schedule_page_test',
      entities: [ScheduleState, ScheduleRegistration, ScheduleDispatch, TriggerRegistration] });
    await Reflect.get(database, 'buildMetadatas').call(database);
    jest.spyOn(database.getRepository(ScheduleState), 'findBy').mockImplementation(stateRead);
    jest.spyOn(database.getRepository(ScheduleRegistration), 'findBy').mockImplementation(bindingRead);
    jest.spyOn(database.getRepository(TriggerRegistration), 'findBy').mockImplementation(registrationRead);
    const dispatchRepository = database.getRepository(ScheduleDispatch);
    const createQuery = dispatchRepository.createQueryBuilder.bind(dispatchRepository);
    jest.spyOn(dispatchRepository, 'createQueryBuilder').mockImplementation((alias) => {
      const query = createQuery(alias);
      query.getMany = async () => {
        queries.push(query.getQueryAndParameters());
        const ids = query.getParameters().scheduleIds as string[];
        return dispatchRows.filter((row) => ids.includes(row.scheduleId));
      };
      return query;
    });
    const definitions = {
      definitions: {
        page: jest.fn(async (query) => ({ list: rows, pageNo: Number(query.pageNo || 1), pageSize: 10, total: rows.length })),
        detail: jest.fn(async () => ({})),
      },
      triggers: { resolve: resolveTrigger },
    } as unknown as ScheduleDefinitionService;
    triggers = new TriggerOccurrenceService(database, {} as never, {} as never);
    control = new ScheduleControlService(database, definitions, {} as never, triggers);
    const dispatch = new ScheduleDispatchService(database, definitions, {} as never, triggers);
    const module = await Test.createTestingModule({
      controllers: [ScheduleController],
      providers: [
        { provide: ScheduleDefinitionService, useValue: definitions },
        { provide: ScheduleControlService, useValue: control },
        { provide: ScheduleDispatchService, useValue: dispatch },
      ],
    }).overrideGuard(JwtAuthGuard).useValue({
      canActivate: (context: ExecutionContext) => {
        const request = context.switchToHttp().getRequest();
        request.adminUser = { roles: [{ status: 1, isDeleted: false, roleCode: 'reader', menus: [
          { status: 1, isDeleted: false, authCode: request.headers['x-permission'] },
        ] }] };
        return true;
      },
    }).compile();
    app = module.createNestApplication();
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  beforeEach(() => {
    rows = [{ id: '10', name: '已启用' }, { id: '20', name: '已停用' }, { id: '30', name: '新草稿' }];
    stateRows[0].enabled = true;
    jest.clearAllMocks();
    queries.length = 0;
  });
  afterAll(async () => { await app?.close(); });

  const page = async (permission = 'Automation:Schedule:List') => {
    const response = await fetch(`${base}/automation/schedules/page?pageNo=2`, { headers: { 'x-permission': permission } });
    return { status: response.status, body: await response.json() };
  };

  it('一次 HTTP 请求返回状态和最新派发，每类依赖只批量读取一次', async () => {
    const result = await page();
    expect(result.status).toBe(200);
    expect(result.body.data).toMatchObject({ pageNo: 2, pageSize: 10, total: 3 });
    expect(result.body.data.list[0].runtime).toMatchObject({ state: { revision: 7, enabled: true, activeVersion: 3, nextRunAt: '2026-09-18T03:00:00.000Z' }, latest: { id: dispatchRows[0].id, targetRunId: dispatchRows[0].targetRunId, status: 'failed', error: '业务拒绝' } });
    expect(result.body.data.list[1].runtime).toMatchObject({ state: { enabled: false, nextRunAt: null, error: '已停用' }, latest: null });
    expect(result.body.data.list[2].runtime).toMatchObject({ state: { revision: 0, enabled: false, activeVersion: null }, latest: null });
    for (const read of [stateRead, bindingRead, registrationRead]) expect(read).toHaveBeenCalledTimes(1);
    expect(resolveTrigger).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0][0]).toMatch(/MAX\(`recent`\.`id`\)/);
    expect(queries[0][0]).toContain('GROUP BY `recent`.`schedule_id`');
    expect(queries[0][1]).toEqual(['10', '20', '30']);
  });

  it('刷新读取最新控制事实，不引入本地缓存或旧修订复用', async () => {
    await page();
    stateRows[0].enabled = false;
    const result = await page();
    expect(result.body.data.list[0].runtime.state).toMatchObject({ enabled: false, nextRunAt: null });
    expect(stateRead).toHaveBeenCalledTimes(2);
  });

  it('空页不读取任何运行依赖', async () => {
    rows = [];
    expect((await page()).body.data.list).toEqual([]);
    expect(stateRead).not.toHaveBeenCalled();
    expect(registrationRead).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it('没有列表权限时返回 403，查询与控制权限不互相替代', async () => {
    expect((await page('Automation:Schedule:Control')).status).toBe(403);
    expect(stateRead).not.toHaveBeenCalled();
  });

  it('单项控制状态复用相同投影，仅单项补充手动触发能力', async () => {
    const list = await control.states(['10']);
    const single = await control.state('10');
    const { manualTrigger, ...shared } = single;
    expect(shared).toEqual(list.get('10'));
    expect(manualTrigger).toBe(true);
    expect(resolveTrigger).toHaveBeenCalledTimes(1);
  });

  it('触发注册批量查询去重但不伪造缺失项', async () => {
    const result = await triggers.readRegistrations(['101', '101', '999']);
    expect(result.map((row) => row.id)).toEqual(['101']);
    expect(registrationRead.mock.calls[0][0].id.value).toEqual(['101', '999']);
  });

  it('已保存绑定的注册缺失时明确拒绝，不显示伪造的运行状态', async () => {
    registrationRead.mockResolvedValueOnce([]);
    await expect(control.states(['10'])).rejects.toThrow('触发注册不存在');
  });
});

import {
  bindScheduleValues,
  normalizeScheduleBindings,
  normalizeScheduleDefinition,
  validateScheduleBindings,
} from '@/modules/task-scheduling/domain/schedule-definition.policy';
import type { DataSchema } from '@/common/automation/data-schema';

const schema: DataSchema = {
  fields: [
    { key: 'amount', label: '金额', type: 'number', required: true, min: 1 },
  ],
};

describe('计划映射与定义边界', () => {
  it('草稿允许暂不选择依赖，不包含嵌入式规则或流程定义', () => {
    const value = normalizeScheduleDefinition({
      schemaVersion: 1,
      triggerRef: null,
      target: null,
      admission: null,
      input: {},
      overlap: 'skip',
      taskDeadlineMs: 1000,
    });
    expect(value.target).toBeNull();
    expect(() =>
      normalizeScheduleDefinition({ ...value, target: { type: 'script' } }),
    ).toThrow('只能是任务或工作流');
  });
  it('拒绝表达式、原型键和非有限常量', () => {
    expect(() =>
      normalizeScheduleBindings({
        amount: { source: 'expression', value: 'process.env' },
      }),
    ).toThrow('来源不支持');
    expect(() =>
      normalizeScheduleBindings(
        JSON.parse('{"__proto__":{"source":"literal","value":1}}'),
      ),
    ).toThrow('标识不合法');
    expect(() =>
      normalizeScheduleBindings({
        amount: { source: 'literal', value: Infinity },
      }),
    ).toThrow('无限数字');
  });
  it('发布映射核验必填来源、类型与常量约束', () => {
    expect(() => validateScheduleBindings({}, schema, schema)).toThrow(
      '必填映射缺失',
    );
    expect(() =>
      validateScheduleBindings(
        { amount: { source: 'literal', value: 0 } },
        schema,
        schema,
      ),
    ).toThrow('最小值');
    expect(() =>
      validateScheduleBindings(
        { amount: { source: 'occurrence', field: 'id' } },
        schema,
        schema,
      ),
    ).toThrow('类型不兼容');
    expect(() =>
      validateScheduleBindings(
        { amount: { source: 'event', field: 'amount' } },
        schema,
        { fields: [{ ...schema.fields[0], required: false }] },
      ),
    ).toThrow('可缺失字段');
    expect(() =>
      validateScheduleBindings(
        { amount: { source: 'event', field: 'amount' } },
        schema,
        { fields: [{ ...schema.fields[0], type: 'integer' }] },
      ),
    ).not.toThrow();
  });
  it('业务载荷不能覆盖发生身份，只有自有字段可以被映射', () => {
    const payload = Object.create({ inherited: 3 });
    payload.id = 'business-id';
    const output = bindScheduleValues(
      {
        eventId: { source: 'event', field: 'id' },
        id: { source: 'occurrence', field: 'id' },
        time: { source: 'occurrence', field: 'occurredAt' },
        ignored: { source: 'event', field: 'inherited' },
      },
      {
        id: '123',
        registrationId: '456',
        triggerRef: { id: '789', version: 1 },
        status: 'pending',
        occurredAt: new Date('2026-09-15T00:00:00Z'),
        payload,
      },
    );
    expect(output).toEqual({
      eventId: 'business-id',
      id: '123',
      time: '2026-09-15T00:00:00.000Z',
    });
  });
});

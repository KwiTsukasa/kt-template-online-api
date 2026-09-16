import {
  normalizeDataSchema,
  validateDataValues,
} from '@/common/automation/data-schema';
import {
  normalizeFormDefinition,
  validateFormValues,
} from '@/modules/form-definition/domain/form.policy';
import {
  evaluateRuleDefinition,
  normalizeRuleDefinition,
} from '@/modules/rule-engine/domain/rule.policy';
import {
  normalizeTriggerDefinition,
  nextTriggerAt,
} from '@/modules/trigger-engine/domain/trigger.policy';

const amount = {
  key: 'amount',
  label: '金额',
  type: 'number',
  required: true,
  min: 0,
  max: 1000,
};
const condition = {
  type: 'compare',
  path: 'amount',
  operator: 'gte',
  value: 100,
};
const rule = {
  schemaVersion: 1,
  factSchema: { fields: [amount] },
  mode: 'condition',
  condition,
  testCases: [],
};
const form = {
  schemaVersion: 1,
  dataSchema: { fields: [amount] },
  uiSchema: {
    columns: 2,
    fields: [
      {
        key: 'amount',
        component: 'InputNumber',
        span: 1,
        placeholder: '',
        help: '',
      },
    ],
  },
};

describe('independent automation definitions', () => {
  it('enforces conditional required fields on complete input without coercing the dependency', () => {
    const definition = normalizeFormDefinition({
      schemaVersion: 1,
      dataSchema: {
        fields: [
          {
            key: 'notify',
            label: '通知申请人',
            type: 'boolean',
            required: true,
          },
          {
            key: 'recipient',
            label: '接收人',
            type: 'string',
            required: false,
          },
        ],
      },
      uiSchema: {
        columns: 1,
        fields: [
          {
            key: 'notify',
            component: 'Switch',
            span: 1,
            placeholder: '',
            help: '',
          },
          {
            key: 'recipient',
            component: 'Input',
            span: 1,
            placeholder: '',
            help: '',
            requiredWhen: { field: 'notify', equals: true },
          },
        ],
      },
    });
    expect(validateFormValues(definition, { notify: false })).toEqual({
      notify: false,
    });
    expect(() => validateFormValues(definition, { notify: true })).toThrow(
      '接收人',
    );
    expect(() =>
      validateFormValues(definition, { notify: true, recipient: ' ' }),
    ).toThrow('不能为空');
    expect(
      validateFormValues(definition, { notify: true, recipient: 'operator' }),
    ).toEqual({ notify: true, recipient: 'operator' });
    expect(() =>
      validateFormValues(definition, { notify: 'true', recipient: 'operator' }),
    ).toThrow('类型');
    expect(() =>
      validateFormValues(definition, { notify: true, recipient: 'operator' }, [
        'notify',
      ]),
    ).toThrow('无权');
    const invalid = JSON.parse(JSON.stringify(definition)) as typeof definition;
    invalid.uiSchema.fields[1].requiredWhen.field = 'missing';
    expect(() => normalizeFormDefinition(invalid)).toThrow('其他已声明字段');
    invalid.uiSchema.fields[1].requiredWhen.field = 'recipient';
    expect(() => normalizeFormDefinition(invalid)).toThrow('其他已声明字段');
    invalid.uiSchema.fields[1].requiredWhen = {
      field: 'notify',
      equals: 'true',
    };
    expect(() => normalizeFormDefinition(invalid)).toThrow('类型');
  });
  it('uses strict numeric rules without coercing text', () => {
    const definition = normalizeRuleDefinition(rule);
    expect(evaluateRuleDefinition(definition, { amount: 100 }).result).toBe(
      true,
    );
    expect(evaluateRuleDefinition(definition, { amount: 99 }).result).toBe(
      false,
    );
    expect(() => evaluateRuleDefinition(definition, { amount: '100' })).toThrow(
      '类型',
    );
  });

  it('rejects rule references outside the declared fact contract', () => {
    expect(() =>
      normalizeRuleDefinition({
        ...rule,
        condition: { ...condition, path: 'constructor' },
      }),
    ).toThrow();
    expect(() =>
      normalizeRuleDefinition({
        ...rule,
        condition: { ...condition, path: 'other' },
      }),
    ).toThrow('未声明');
    expect(() =>
      normalizeRuleDefinition({
        ...rule,
        condition: { ...condition, value: '100' },
      }),
    ).toThrow();
  });

  it('evaluates nested groups and selects the first matching decision row', () => {
    const definition = normalizeRuleDefinition({
      ...rule,
      mode: 'decision-table',
      rows: [
        {
          id: 'priority',
          condition: {
            type: 'all',
            rules: [
              condition,
              { type: 'not', rule: { ...condition, value: 500 } },
            ],
          },
          result: 'priority',
        },
        { id: 'normal', condition, result: 'normal' },
      ],
      defaultResult: 'none',
    });
    expect(evaluateRuleDefinition(definition, { amount: 200 })).toMatchObject({
      result: 'priority',
      matchedRowId: 'priority',
    });
    expect(evaluateRuleDefinition(definition, { amount: 600 })).toMatchObject({
      result: 'normal',
      matchedRowId: 'normal',
    });
    expect(evaluateRuleDefinition(definition, { amount: 20 })).toMatchObject({
      result: 'none',
      matchedRowId: null,
    });
    const evaluated = evaluateRuleDefinition(definition, { amount: 20 });
    expect(
      evaluated.trace.map(({ location, matched }) => [location, matched]),
    ).toEqual([
      ['rows.priority', false],
      ['rows.priority.0', false],
      ['rows.priority.1', true],
      ['rows.priority.1.0', false],
      ['rows.normal', false],
    ]);
    expect(JSON.stringify(evaluated.trace)).not.toContain('"value"');
    expect(
      evaluateRuleDefinition(definition, { amount: 200 }).trace,
    ).toHaveLength(4);
  });

  it('validates the full form schema and permits only compatible registered controls', () => {
    expect(normalizeFormDefinition(form).uiSchema.fields[0].component).toBe(
      'InputNumber',
    );
    expect(() =>
      normalizeFormDefinition({
        ...form,
        uiSchema: {
          columns: 2,
          fields: [{ ...form.uiSchema.fields[0], component: 'Script' }],
        },
      }),
    ).toThrow('控件');
    expect(() =>
      normalizeFormDefinition({
        ...form,
        uiSchema: { columns: 2, fields: [] },
      }),
    ).toThrow('每个数据字段');
  });

  it.each([
    [{}, '必填'],
    [{ amount: -1 }, '最小'],
    [{ amount: 1001 }, '最大'],
    [{ amount: 100, extra: true }, '未声明'],
    [{ amount: null }, '类型'],
  ])('rejects invalid instance data without storing it', (values, error) => {
    const schema = normalizeFormDefinition(form).dataSchema;
    expect(() => validateDataValues(schema, values)).toThrow(String(error));
  });

  it('rejects client-written fields excluded by the consumer authorization', () => {
    const schema = normalizeFormDefinition(form).dataSchema;
    expect(() => validateDataValues(schema, { amount: 10 }, [])).toThrow(
      '无权',
    );
    expect(validateDataValues(schema, { amount: 10 }, ['amount'])).toEqual({
      amount: 10,
    });
  });

  it('validates date calendar identity, enumeration, and integer values', () => {
    const dates = normalizeDataSchema({
      fields: [
        {
          key: 'day',
          label: '日期',
          type: 'string',
          required: true,
          format: 'date',
        },
      ],
    });
    expect(() => validateDataValues(dates, { day: '2026-02-30' })).toThrow(
      '日期',
    );
    expect(validateDataValues(dates, { day: '2024-02-29' })).toEqual({
      day: '2024-02-29',
    });
    const values = normalizeDataSchema({
      fields: [
        {
          key: 'count',
          label: '数量',
          type: 'integer',
          required: true,
          options: [{ label: '一个', value: 1 }],
        },
      ],
    });
    expect(() => validateDataValues(values, { count: 1.5 })).toThrow('类型');
    expect(() => validateDataValues(values, { count: 2 })).toThrow('选项');
  });

  it('keeps cron timezones, interval boundaries and expired one-shot semantics', () => {
    const definition = normalizeTriggerDefinition({
      schemaVersion: 1,
      trigger: {
        type: 'cron',
        expression: '0 9 * * *',
        timezone: 'Asia/Shanghai',
      },
    });
    expect(
      nextTriggerAt(
        definition.trigger,
        new Date('2026-09-15T00:30:00Z'),
      )?.toISOString(),
    ).toBe('2026-09-15T01:00:00.000Z');
    expect(() =>
      normalizeTriggerDefinition({
        schemaVersion: 1,
        trigger: { type: 'interval', everyMs: 999 },
      }),
    ).toThrow();
    expect(
      nextTriggerAt(
        { type: 'once', at: '2026-09-14T00:00:00Z' },
        new Date('2026-09-15T00:00:00Z'),
      ),
    ).toBeNull();
    expect(
      nextTriggerAt({
        type: 'event',
        eventKey: 'message.created',
        eventVersion: 1,
        payloadSchema: { fields: [] },
      }),
    ).toBeNull();
  });
});

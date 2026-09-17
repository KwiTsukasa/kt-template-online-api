import 'reflect-metadata';
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { DataSource, getMetadataArgsStorage } from 'typeorm';

const modules = [
  'workflow-engine',
  'form-definition',
  'rule-engine',
  'trigger-engine',
  'task-scheduling',
  'task-execution',
  'automation-monitor',
];
const entities: Array<new () => object> = [];
beforeAll(async () => {
  for (const name of modules) {
    const root = resolve(__dirname, '../../../src/modules', name);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter(
      (file) => /\.entit(?:y|ies)\.ts$/.test(file),
    );
    for (const file of files) {
      const exports = await import(resolve(root, file));
      entities.push(
        ...Object.values(exports).filter(
          (value): value is new () => object => typeof value === 'function',
        ),
      );
    }
  }
}, 30000);

it('全部自动化实体在MySQL驱动下可装配，常量类型别名不能退化成Object列', async () => {
  const targets = new Set(entities);
  const ambiguous = getMetadataArgsStorage()
    .columns.filter(
      (column) =>
        targets.has(column.target as new () => object) &&
        (column.options.type as unknown) === Object,
    )
    .map(
      (column) =>
        `${(column.target as { name: string }).name}.${column.propertyName}`,
    );
  expect(ambiguous).toEqual([]);
  const database = new DataSource({
    type: 'mysql',
    database: 'metadata_only',
    entities,
    synchronize: false,
  });
  await (
    database as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
  expect(
    database.entityMetadatas.some(
      (entity) => entity.name === 'TriggerOccurrence',
    ),
  ).toBe(true);
  expect(
    database.entityMetadatas.some(
      (entity) => entity.name === 'WorkflowBpmnActivity',
    ),
  ).toBe(true);
});

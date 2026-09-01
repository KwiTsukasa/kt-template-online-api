import { getMetadataArgsStorage } from 'typeorm';
import {
  MEDIA_GOVERNANCE_ENTITIES,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceOutboxEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '../../../src/modules/admin/media-governance/infrastructure/persistence/media-governance.entities';

describe('media governance entity schema', () => {
  const entities = [
    [MediaGovernanceTaskEntity, 'media_governance_task'],
    [MediaGovernanceUnitEntity, 'media_governance_unit'],
    [MediaGovernanceSourceEntity, 'media_governance_source'],
    [
      MediaGovernanceDescriptorRevisionEntity,
      'media_governance_descriptor_revision',
    ],
    [MediaGovernanceRunEntity, 'media_governance_run'],
    [MediaGovernanceEventEntity, 'media_governance_event'],
    [MediaGovernanceOutboxEntity, 'media_governance_outbox'],
  ] as const;

  it('registers the complete Slice 2 table set once', () => {
    expect(MEDIA_GOVERNANCE_ENTITIES).toEqual(
      entities.map(([entity]) => entity),
    );
    expect(
      entities.map(
        ([entity]) =>
          getMetadataArgsStorage().tables.find(
            (table) => table.target === entity,
          )?.name,
      ),
    ).toEqual(entities.map(([, tableName]) => tableName));
  });

  it.each(entities)('%s has an explicit string primary key', (entity) => {
    const primaryColumns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === entity && column.options.primary,
    );
    expect(primaryColumns).toHaveLength(1);
    expect(primaryColumns[0]?.propertyName).toBe('id');
    expect(primaryColumns[0]?.options.type).toBe('varchar');
  });

  it('deduplicates semantic callbacks by Task, run and sequence', () => {
    expect(
      getMetadataArgsStorage().indices.find(
        (index) =>
          index.target === MediaGovernanceEventEntity &&
          index.name === 'uk_media_governance_event_task_run_sequence',
      ),
    ).toMatchObject({
      columns: ['taskId', 'runId', 'sequence'],
      unique: true,
    });
  });

  it('persists the explicit selected-file mapping projection on each source', () => {
    expect(
      getMetadataArgsStorage().columns.find(
        (column) =>
          column.target === MediaGovernanceSourceEntity &&
          column.propertyName === 'selectedFileMappings',
      )?.options,
    ).toMatchObject({ name: 'selected_file_mappings', nullable: true });
  });
});

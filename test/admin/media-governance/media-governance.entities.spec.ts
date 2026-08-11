import { getMetadataArgsStorage } from 'typeorm';
import {
  MEDIA_GOVERNANCE_ENTITIES,
  MediaGovernanceAgentSessionEntity,
  MediaGovernanceDescriptorRevisionEntity,
  MediaGovernanceEventEntity,
  MediaGovernanceMetadataExceptionEntity,
  MediaGovernanceOperatorDecisionEntity,
  MediaGovernanceOutboxEntity,
  MediaGovernanceRunEntity,
  MediaGovernanceSourceEntity,
  MediaGovernanceTaskEntity,
  MediaGovernanceUnitEntity,
} from '../../../src/modules/admin/media-governance/media-governance.entities';

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
    [MediaGovernanceAgentSessionEntity, 'media_governance_agent_session'],
    [
      MediaGovernanceMetadataExceptionEntity,
      'media_governance_metadata_exception',
    ],
    [
      MediaGovernanceOperatorDecisionEntity,
      'media_governance_operator_decision',
    ],
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

  it('persists the recovery waterline and enforces one Agent session per Task', () => {
    const columns = getMetadataArgsStorage().columns.filter(
      (column) => column.target === MediaGovernanceAgentSessionEntity,
    );
    expect(columns.map((column) => column.propertyName)).toEqual(
      expect.arrayContaining([
        'lastSequence',
        'pendingPlanSha256',
        'policyVersion',
        'currentActionLabel',
      ]),
    );
    expect(
      getMetadataArgsStorage().indices.find(
        (index) =>
          index.target === MediaGovernanceAgentSessionEntity &&
          Array.isArray(index.columns) &&
          index.columns.includes('taskId'),
      )?.unique,
    ).toBe(true);
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
});

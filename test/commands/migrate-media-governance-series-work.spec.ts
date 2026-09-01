import { assertMediaGovernanceSeriesWorkMigrationVerification } from '../../src/commands/migrate-media-governance-series-work';

describe('Media Governance Series-first migration command', () => {
  const valid = {
    closed_task_without_scrape_validation_count: 0,
    duplicate_work_canonical_count: 0,
    invalid_series_namespace_count: 0,
    legacy_media_agent_table_count: 0,
    legacy_media_task_column_count: 0,
    legacy_media_unit_column_count: 0,
    legacy_series_reference_without_work_ref_count: 0,
    non_tv_work_with_season_count: 0,
    orphan_scrape_validation_count: 0,
    rss_context_column_count: 4,
    rss_context_index_count: 2,
    rss_context_missing_identity_count: 0,
    rss_context_work_ref_mismatch_count: 0,
    season_work_mismatch_count: 0,
    schema_contract_mismatch_count: 0,
    scrape_validation_required_column_count: 19,
    scrape_validation_table_count: 1,
    scrape_validation_task_unique_index_count: 1,
    series_delete_missing_super_binding_count: 0,
    series_delete_non_super_binding_count: 0,
    series_delete_permission_conflict_count: 0,
    series_delete_permission_duplicate_count: 0,
    series_delete_permission_identity_count: 1,
    series_without_primary_work_count: 0,
    task_work_series_mismatch_count: 0,
    work_table_count: 2,
  };

  it('accepts the complete ownership and reference verification matrix', () => {
    expect(assertMediaGovernanceSeriesWorkMigrationVerification(valid)).toEqual(
      valid,
    );
  });

  it('rejects a missing legacy Work reference', () => {
    expect(() =>
      assertMediaGovernanceSeriesWorkMigrationVerification({
        ...valid,
        legacy_series_reference_without_work_ref_count: 1,
      }),
    ).toThrow('legacy_series_reference_without_work_ref_count=1');
  });

  it('rejects an RSS identity that is not registered on the bound Work', () => {
    expect(() =>
      assertMediaGovernanceSeriesWorkMigrationVerification({
        ...valid,
        rss_context_work_ref_mismatch_count: 1,
      }),
    ).toThrow('rss_context_work_ref_mismatch_count=1');
  });

  it('rejects a mechanical task without an independent scrape record', () => {
    expect(() =>
      assertMediaGovernanceSeriesWorkMigrationVerification({
        ...valid,
        closed_task_without_scrape_validation_count: 1,
      }),
    ).toThrow('closed_task_without_scrape_validation_count=1');
  });
});

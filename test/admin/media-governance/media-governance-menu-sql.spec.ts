import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('media governance intake menu seed', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-intake-menu.sql'),
    'utf8',
  );

  it('registers mechanical governance and independent scraping routes', () => {
    expect(sql).toContain("'MediaGovernance'");
    expect(sql).toContain("'/media/governance/series'");
    expect(sql).toContain("'/media/governance/series/list'");
    expect(sql).toContain("'MediaGovernanceSeriesDetail'");
    expect(sql).toContain("'/media/governance/series/:seriesId'");
    expect(sql).toContain("'/media/governance/series/detail'");
    expect(sql).toContain("'/media/governance/tasks'");
    expect(sql).toContain("'/media/governance/tasks/list'");
    expect(sql).toContain("'Media:Governance:List'");
    expect(sql).toContain("'Media:Governance:Create'");
    expect(sql).toContain("'Media:Governance:Delete'");
    expect(sql).toContain("'MediaScrapeValidation'");
    expect(sql).toContain("'/media/scrape-validation'");
    expect(sql).toContain("'/media/scrape-validation/list'");
    for (const permission of [
      'Media:Governance:SourceUpload',
      'Media:Governance:Download',
      'Media:Governance:Run',
      'Media:Governance:Evidence',
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
    expect(sql).toContain("'MediaGovernanceAgentQueue'");
    expect(sql).toContain('`is_deleted` = 1');
  });

  it('grants the demo only to active super roles', () => {
    expect(sql).toContain("WHERE role.`role_code` = 'super'");
    expect(sql).toContain("WHERE role.`role_code` <> 'super'");
    expect(sql).toContain('INSERT IGNORE INTO `admin_role_menu`');
  });
});

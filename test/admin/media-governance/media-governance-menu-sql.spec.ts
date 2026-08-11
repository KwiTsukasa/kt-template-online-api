import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('media governance intake menu seed', () => {
  const sql = readFileSync(
    resolve(process.cwd(), 'sql/media-governance-intake-menu.sql'),
    'utf8',
  );

  it('registers the task/Agent routes and the complete permission set', () => {
    expect(sql).toContain("'MediaGovernance'");
    expect(sql).toContain("'/media/governance/tasks'");
    expect(sql).toContain("'/media/governance/tasks/list'");
    expect(sql).toContain("'Media:Governance:List'");
    expect(sql).toContain("'Media:Governance:Create'");
    expect(sql).toContain("'/media/governance/agent-queue'");
    for (const permission of [
      'Media:Governance:SourceUpload',
      'Media:Governance:Download',
      'Media:Governance:Run',
      'Media:Governance:AgentStart',
      'Media:Governance:AgentOperate',
      'Media:Governance:OperatorDecision',
      'Media:Governance:Evidence',
    ]) {
      expect(sql).toContain(`'${permission}'`);
    }
  });

  it('grants the demo only to active super roles', () => {
    expect(sql).toContain("WHERE role.`role_code` = 'super'");
    expect(sql).toContain("WHERE role.`role_code` <> 'super'");
    expect(sql).toContain('INSERT IGNORE INTO `admin_role_menu`');
  });
});

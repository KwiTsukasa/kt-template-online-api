import {
  getEnvironmentDashboardActions,
  HIGH_RISK_ENVIRONMENT_ACTION_IDS,
} from '../../../../src/modules/admin/platform-config/environment-dashboard/application/environment-dashboard-action.catalog';

describe('environment dashboard action catalog', () => {
  it('keeps readonly actions enabled for dashboard workflows', () => {
    const actions = getEnvironmentDashboardActions();

    expect(
      actions
        .filter((action) => action.kind === 'readonly')
        .map((action) => [action.id, action.enabled]),
    ).toEqual([
      ['refresh-dashboard', true],
      ['run-self-check', true],
      ['open-runtime-logs', true],
      ['open-service-route', true],
    ]);
  });

  it('renders all high-risk write actions as disabled records', () => {
    const actions = getEnvironmentDashboardActions();

    HIGH_RISK_ENVIRONMENT_ACTION_IDS.forEach((id) => {
      const action = actions.find((candidate) => candidate.id === id);
      expect(action).toMatchObject({
        enabled: false,
        id,
        kind: 'write-risk',
      });
      expect(action?.disabledReason).toContain('只读');
    });
  });
});

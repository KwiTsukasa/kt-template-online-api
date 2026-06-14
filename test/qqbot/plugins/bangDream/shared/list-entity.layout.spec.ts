import {
  BANGDREAM_ENTITY_LIST_SPEC,
  shouldUseSingleEntityLabel,
} from '@/modules/qqbot/plugins/bangDream/shared/list-entity.layout';

describe('BangDream entity list spec', () => {
  it('keeps the historical multi-value spacing stable', () => {
    expect(BANGDREAM_ENTITY_LIST_SPEC.multiValueSpacing).toBe(0);
  });

  it('uses single entity label only when there is one entity and no override text', () => {
    expect(shouldUseSingleEntityLabel(1)).toBe(true);
    expect(shouldUseSingleEntityLabel(1, 'override')).toBe(false);
    expect(shouldUseSingleEntityLabel(2)).toBe(false);
  });
});

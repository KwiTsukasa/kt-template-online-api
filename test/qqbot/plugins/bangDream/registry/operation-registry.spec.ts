import {
  BANGDREAM_OPERATION_REGISTRY,
  getBangDreamOperationDefinition,
} from '@/qqbot/plugins/bangDream/registry/operation-registry';

describe('BangDream Tsugu operation registry', () => {
  it('keeps operation keys unique and complete', () => {
    const operationKeys = BANGDREAM_OPERATION_REGISTRY.map(
      (operation) => operation.key,
    );

    expect(new Set(operationKeys).size).toBe(operationKeys.length);
    expect(operationKeys).toHaveLength(15);
  });

  it('keeps every operation bound to a handler and online command defaults', () => {
    for (const operation of BANGDREAM_OPERATION_REGISTRY) {
      expect(operation.handlerName).toEqual(expect.any(String));
      expect(operation.name).not.toHaveLength(0);
      expect(operation.description).not.toHaveLength(0);
      expect(operation.onlineCommand.aliases.length).toBeGreaterThan(0);
      expect(operation.onlineCommand.cooldownMs).toBeGreaterThan(0);
      expect(operation.onlineCommand.remark).not.toHaveLength(0);
    }
  });

  it('finds operations by key', () => {
    expect(
      getBangDreamOperationDefinition('bangdream.song.search'),
    ).toMatchObject({
      handlerName: 'searchSong',
      name: '查曲',
    });
    expect(getBangDreamOperationDefinition('bangdream.unknown')).toBeUndefined();
  });
});

describe('QQBot core injection metadata', () => {
  it('keeps the command sender dependency defined when the send service loads first', () => {
    jest.isolateModules(() => {
      const { QqbotSendService } = jest.requireActual<
        typeof import('../../../../src/modules/qqbot/core/application/send/qqbot-send.service')
      >(
        '../../../../src/modules/qqbot/core/application/send/qqbot-send.service',
      );
      const { QqbotCommandEngineService } = jest.requireActual<
        typeof import('../../../../src/modules/qqbot/core/application/command/qqbot-command-engine.service')
      >(
        '../../../../src/modules/qqbot/core/application/command/qqbot-command-engine.service',
      );
      const parameterTypes = Reflect.getMetadata(
        'design:paramtypes',
        QqbotCommandEngineService,
      );

      expect(parameterTypes[4]).toBe(QqbotSendService);
    });
  });
});

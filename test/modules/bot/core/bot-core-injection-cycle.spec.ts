describe('QQBot core injection metadata', () => {
  it('keeps the command sender dependency defined when the send service loads first', () => {
    jest.isolateModules(() => {
      const { BotSendService } = jest.requireActual<
        typeof import('../../../../src/modules/bot-adapter/core/application/send/bot-send.service')
      >(
        '../../../../src/modules/bot-adapter/core/application/send/bot-send.service',
      );
      const { BotCommandEngineService } = jest.requireActual<
        typeof import('../../../../src/modules/bot-adapter/core/application/command/bot-command-engine.service')
      >(
        '../../../../src/modules/bot-adapter/core/application/command/bot-command-engine.service',
      );
      const parameterTypes = Reflect.getMetadata(
        'design:paramtypes',
        BotCommandEngineService,
      );

      expect(parameterTypes[4]).toBe(BotSendService);
    });
  });
});

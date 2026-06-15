import { ToolsService } from '@/common';
import { QqbotNapcatContainerService } from '@/modules/qqbot/napcat/qqbot-napcat-container.service';

describe('QqbotNapcatContainerService captcha logs', () => {
  it('extracts captcha url from recent runtime logs', async () => {
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_NAPCAT_CONTAINER_MODE' ? 'ssh' : '',
        ),
      } as any,
      { update: jest.fn() } as any,
      {} as any,
      new ToolsService(),
    );
    jest.spyOn(service as any, 'runProcess').mockResolvedValue({
      stderr: '',
      stdout:
        '密码回退需要验证码，请在 WebUi 中继续完成验证：https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001\n',
    });

    const result = await service.detectRuntimeCaptchaUrl(
      {
        id: 'container-1',
        name: 'napcat-10001',
      } as any,
      Date.now(),
    );

    expect(result).toBe(
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001',
    );
  });

  it('extracts captcha url from quoted json runtime logs', async () => {
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_NAPCAT_CONTAINER_MODE' ? 'ssh' : '',
        ),
      } as any,
      { update: jest.fn() } as any,
      {} as any,
      new ToolsService(),
    );
    jest.spyOn(service as any, 'runProcess').mockResolvedValue({
      stderr: '',
      stdout:
        '{"loginErrorInfo":{"proofWaterUrl":"https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001&sid=abc"}},\n',
    });

    const result = await service.detectRuntimeCaptchaUrl(
      {
        id: 'container-1',
        name: 'napcat-10001',
      } as any,
      Date.now(),
    );

    expect(result).toBe(
      'https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001&sid=abc',
    );
  });

  it('uses a longer timeout for captcha log reads than the quick runtime check', async () => {
    const service = new QqbotNapcatContainerService(
      {
        get: jest.fn((key: string) =>
          key === 'QQBOT_NAPCAT_CONTAINER_MODE' ? 'ssh' : '',
        ),
      } as any,
      { update: jest.fn() } as any,
      {} as any,
      new ToolsService(),
    );
    const runProcess = jest.spyOn(service as any, 'runProcess').mockResolvedValue({
      stderr: '',
      stdout:
        '需要验证码, proofWaterUrl: https://ti.qq.com/safe/tools/captcha/sms-verify-login?uin=10001\n',
    });

    await service.detectRuntimeCaptchaUrl(
      {
        id: 'container-1',
        name: 'napcat-10001',
      } as any,
      Date.now(),
    );

    expect(runProcess.mock.calls[0]?.[4]).toBeGreaterThanOrEqual(15000);
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  AutomationValidationError,
  isAutomationRejection,
  rejectDefinitionInput,
  requireAuthorized,
  requireConsistent,
  requireDefinition,
  requireFound,
  requireRequest,
} from '@/common/automation/validation';
import { validateDefinitionInput } from '@/common/automation/definition.repository';

describe('自动化统一拒绝边界', () => {
  it.each([
    [requireDefinition, AutomationValidationError],
    [requireRequest, BadRequestException],
    [requireConsistent, ConflictException],
    [requireFound, NotFoundException],
    [requireAuthorized, ForbiddenException],
  ] as const)('公共断言保留异常类别和说明', (check, ErrorType) => {
    expect(() => check(true, '拒绝原因')).not.toThrow();
    expect(() => check(false, '拒绝原因')).toThrow(ErrorType);
    expect(() => check(false, '拒绝原因')).toThrow('拒绝原因');
  });
  it('非 Error 抛出值保持请求错误，不能在读取 message 时再次崩溃', () => {
    for (const value of [null, undefined, false, 'invalid']) {
      expect(() =>
        validateDefinitionInput(() => {
          throw value;
        }),
      ).toThrow('定义数据不合法');
      expect(() => rejectDefinitionInput(value)).toThrow(BadRequestException);
    }
  });
  it('未知技术故障仍交给恢复层，只将明确的输入拒绝分类为业务失败', () => {
    expect(isAutomationRejection(new Error('network failed'))).toBe(false);
    expect(isAutomationRejection(new ConflictException('stale'))).toBe(false);
    expect(
      isAutomationRejection(new AutomationValidationError('invalid')),
    ).toBe(true);
    expect(isAutomationRejection(new BadRequestException('invalid'))).toBe(
      true,
    );
  });
});

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';

// 标记输入或业务契约不成立，供请求边界与执行器区分校验拒绝和技术故障。
export class AutomationValidationError extends Error {}

/**
 * 统一终止无法匹配合法领域分支的输入解析，返回类型保证调用方不会继续执行。
 * @param message - 当前契约拒绝该输入的原因。
 * @throws 抛出可与技术故障区分的领域校验异常。
 */
export function rejectDefinition(message: string): never {
  throw new AutomationValidationError(message);
}

/**
 * 将纯定义解析的错误转换为请求拒绝，非错误抛出值使用固定说明。
 * @param error - 无数据库或外部副作用的定义解析异常。
 * @throws 定义无法解析时返回 HTTP 400。
 */
export function rejectDefinitionInput(error: unknown): never {
  if (error instanceof Error) throw new BadRequestException(error.message);
  throw new BadRequestException('定义数据不合法');
}

/**
 * 只把显式领域校验与请求拒绝视为业务失败，数据库、网络及未知异常交给恢复层处理。
 * @param error - 业务准备、结果验收或规则求值抛出的异常。
 * @returns 异常明确表示业务输入或事实被拒绝时返回真。
 */
export function isAutomationRejection(error: unknown): boolean {
  return (
    error instanceof AutomationValidationError ||
    error instanceof BadRequestException
  );
}

/**
 * 只将明确的定义、语法及依赖缺失转成定位问题，依赖查询的技术故障继续传播。
 * @param error - 发布校验捕获的异常。
 * @returns 可向编辑器报告的契约错误说明。
 * @throws 数据库、网络或其他未分类错误不能伪装成定义问题。
 */
export function definitionRejectionMessage(error: unknown): string {
  if (
    isAutomationRejection(error) ||
    error instanceof SyntaxError ||
    error instanceof NotFoundException
  )
    return String(error);
  throw error;
}

/**
 * 统一拒绝不满足契约的输入，并保留 TypeScript 对成功分支的类型收窄。
 * @param valid - 当前领域约束是否成立。
 * @param message - 对应领域约束的明确说明。
 * @throws 约束不成立时抛出可分类的输入校验错误。
 */
export function requireDefinition(
  valid: unknown,
  message: string,
): asserts valid {
  if (!valid) rejectDefinition(message);
}

/**
 * 统一核验引擎能力、恢复状态与运行环境，失败保留技术异常类别，不能作为业务拒绝处理。
 * @param valid - 继续执行所需的运行条件是否成立。
 * @param message - 缺失能力或异常状态的说明。
 * @throws 运行条件不成立时抛出技术错误，交给调用方恢复或停止启动。
 */
export function requireExecutionState(
  valid: unknown,
  message: string,
): asserts valid {
  if (!valid) throw new Error(message);
}

/**
 * 在请求边界统一拒绝不合法输入，保留调用点的成功分支类型收窄。
 * @param valid - 当前输入约束是否成立。
 * @param message - 返回给调用方的具体校验原因。
 * @throws 输入约束不成立时返回 HTTP 400。
 */
export function requireRequest(valid: unknown, message: string): asserts valid {
  if (!valid) throw new BadRequestException(message);
}

/**
 * 统一核对并发修订和幂等约束，冲突时由调用方刷新状态后重试。
 * @param valid - 当前状态是否仍满足本次操作的前置条件。
 * @param message - 冲突对应的业务说明。
 * @throws 状态或幂等约束不成立时返回 HTTP 409。
 */
export function requireConsistent(
  valid: unknown,
  message: string,
): asserts valid {
  if (!valid) throw new ConflictException(message);
}

/**
 * 统一拒绝缺失资源，资源存在时向后续代码提供非空约束。
 * @param value - 查询得到的资源或存在性结果。
 * @param message - 当前资源缺失的说明。
 * @throws 资源不存在时返回 HTTP 404。
 */
export function requireFound(value: unknown, message: string): asserts value {
  if (!value) throw new NotFoundException(message);
}

/**
 * 统一核对自动化操作的业务权限，不改变请求认证边界。
 * @param allowed - 当前身份是否被授予该操作。
 * @param message - 权限拒绝说明。
 * @throws 权限不满足时返回 HTTP 403。
 */
export function requireAuthorized(
  allowed: unknown,
  message: string,
): asserts allowed {
  if (!allowed) throw new ForbiddenException(message);
}

/**
 * 校验整数范围，不接受数字字符串、小数或非有限数值。
 * @param value - 待验证的业务数字。
 * @param min - 包含在范围内的最小整数。
 * @param max - 包含在范围内的最大整数。
 * @param message - 不符合当前业务范围时的说明。
 * @returns 原始合法整数，不进行隐式转换。
 * @throws 类型或范围不符合整数契约时拒绝输入。
 */
export function definitionInteger(
  value: unknown,
  min: number,
  max: number,
  message: string,
): number {
  requireDefinition(
    typeof value === 'number' &&
      Number.isSafeInteger(value) &&
      value >= min &&
      value <= max,
    message,
  );
  return value;
}

/**
 * 以一次索引检查封闭对象的字段集合，嵌套业务扩展必须由所属契约单独声明。
 * @param value - 已确认的普通对象。
 * @param allowed - 该层允许出现的字段集合。
 * @param message - 出现未声明字段时的说明。
 * @throws 对象包含额外字段时拒绝输入。
 */
export function requireDefinitionKeys(
  value: Record<string, unknown>,
  allowed: ReadonlySet<string>,
  message: string,
): void {
  requireDefinition(
    Object.keys(value).every((key) => allowed.has(key)),
    message,
  );
}

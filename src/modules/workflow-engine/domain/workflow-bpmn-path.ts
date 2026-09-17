import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import { requireDefinition } from '@/common/automation/validation';
import {
  BPMN_EXPRESSION_CONTEXTS,
  BPMN_EXPRESSION_SEGMENT,
} from '../constants/bpmn';

/**
 * 普通字段沿用点分路径，包含点号或 Unicode 的标准节点身份使用 JSON Pointer，避免混淆节点名和嵌套字段。
 * @param parts - 已按上下文、节点及字段分离的路径片段。
 * @returns 无歧义且保留既有普通路径字节的表达式路径。
 */
export function bpmnPath(parts: readonly string[]): string {
  if (parts.every((part) => BPMN_EXPRESSION_SEGMENT.test(part)))
    return parts.join('.');
  return (
    '/' +
    parts
      .map((part) => part.replaceAll('~', '~0').replaceAll('/', '~1'))
      .join('/')
  );
}

/**
 * 将点分路径或 JSON Pointer 还原为自有属性片段，只开放四类工作流上下文并拒绝原型及损坏转义。
 * @param path - 表达式声明的字段路径。
 * @returns 可逐层用自有属性读取的精确片段。
 * @throws 上下文、字段或转义不合法时拒绝读取。
 */
export function bpmnPathParts(path: string): string[] {
  let parts = path.split('.');
  if (path.startsWith('/')) {
    parts = path
      .slice(1)
      .split('/')
      .map((part) => {
        requireDefinition(!/~(?![01])/.test(part), 'BPMN 表达式路径转义不合法');
        return part.replaceAll('~1', '/').replaceAll('~0', '~');
      });
  } else
    requireDefinition(
      parts.every((part) => BPMN_EXPRESSION_SEGMENT.test(part)),
      'BPMN 表达式字段路径不合法',
    );
  requireDefinition(
    BPMN_EXPRESSION_CONTEXTS.has(parts[0]) &&
      parts.every((part) => part.length > 0),
    'BPMN 表达式只能读取已声明的上下文路径',
  );
  requireDefinition(
    !parts.some((part) => FORBIDDEN_OBJECT_KEYS.has(part)),
    'BPMN 表达式路径不允许访问原型',
  );
  return parts;
}

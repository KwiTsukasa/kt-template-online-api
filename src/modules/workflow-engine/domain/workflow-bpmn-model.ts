/// <reference types="../contract/bpmn-moddle" />
import * as BpmnModdle from 'bpmn-moddle';
import { BPMN_FORMAT, KT_BPMN_MODDLE, type WorkflowBpmnDefinition, type WorkflowBpmnElement, type WorkflowBpmnModel, type WorkflowBpmnRecord } from '../contract/workflow-bpmn.types';

/**
 * 直接恢复结构化标准模型，元素引用按标识连接；编辑、保存和运行均不经过 XML。
 * @param input - 带标准元素类型、属性和引用的流程文档。
 * @returns 可用于标准校验、X6 映射和执行引擎的内存元模型。
 * @throws 类型、属性、引用、规模或标识非法时拒绝恢复。
 */
export function hydrateWorkflowBpmn(input: unknown): WorkflowBpmnModel {
  const source = input as WorkflowBpmnDefinition;
  if (!source || source.format !== BPMN_FORMAT || !source.model || typeof source.model !== 'object' || Object.hasOwn(source, 'xml')) throw new Error('工作流内部定义必须使用结构化 BPMN 模型');
  if (Buffer.byteLength(JSON.stringify(source.model), 'utf8') > 2 * 1024 * 1024) throw new Error('BPMN 模型不能超过 2 MiB');
  const moddle = new BpmnModdle({ kt: KT_BPMN_MODDLE });
  const elements: Record<string, WorkflowBpmnElement> = Object.create(null);
  const references: Array<{ owner: WorkflowBpmnElement; property: any; value: unknown }> = [];
  const resolvedReferences: WorkflowBpmnModel['references'] = [];
  let count = 0;
  const restore = (raw: unknown, parent?: WorkflowBpmnElement, depth = 0): WorkflowBpmnElement => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw) || depth > 32 || ++count > 4096) throw new Error('BPMN 元素结构或规模无效');
    const record = raw as WorkflowBpmnRecord;
    if (typeof record.$type !== 'string' || !/^(bpmn|bpmndi|dc|di|kt):/.test(record.$type)) throw new Error('BPMN 元素类型不支持');
    const element = moddle.create(record.$type) as WorkflowBpmnElement;
    if (parent) element.$parent = parent;
    for (const [name, value] of Object.entries(record)) {
      if (name === '$type') continue;
      if (['__proto__', 'constructor', 'prototype'].includes(name)) throw new Error('BPMN 模型包含不允许的属性');
      const property = element.$descriptor.properties.find((item: any) => item.name === name && !item.isVirtual);
      if (!property) throw new Error(`${record.$type} 不存在标准属性 ${name}`);
      if (property.isReference) { references.push({ owner: element, property, value }); continue; }
      const restoreValue = (item: unknown) => {
        if (item && typeof item === 'object') {
          const child = restore(item, element, depth + 1);
          if (property.type !== 'Element' && !child.$instanceOf(property.type)) throw new Error(`${name} 的元素类型不相容`);
          return child;
        }
        if (property.type === 'Boolean') {
          if (typeof item !== 'boolean') throw new Error(`${name} 必须是布尔值`);
          return item;
        }
        if (['Integer', 'Real'].includes(property.type)) {
          if (typeof item !== 'number' || !Number.isFinite(item)) throw new Error(`${name} 必须是有限数值`);
          if (property.type === 'Integer' && !Number.isSafeInteger(item)) throw new Error(`${name} 必须是整数`);
          return item;
        }
        if ((property.type === 'String' || property.isAttr || property.isBody) && typeof item === 'string') return item;
        throw new Error(`${name} 的标准属性值类型不合法`);
      };
      if (property.isMany) {
        if (!Array.isArray(value)) throw new Error(`${name} 必须是列表`);
        element.set(name, value.map(restoreValue));
      } else element.set(name, restoreValue(value));
    }
    if (element.id !== undefined) {
      if (typeof element.id !== 'string' || !/^[\p{L}_][\p{L}\p{M}\p{N}_.-]{0,190}$/u.test(element.id) || Object.hasOwn(elements, element.id)) throw new Error('BPMN 元素标识无效或重复');
      elements[element.id] = element;
    }
    return element;
  };
  const root = restore(source.model);
  if (root.$type !== 'bpmn:Definitions') throw new Error('BPMN 模型根节点必须是 Definitions');
  for (const reference of references) {
    const resolve = (raw: unknown) => {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).length !== 1 || typeof (raw as any).$ref !== 'string') throw new Error('BPMN 引用必须包含唯一的 $ref 标识');
      const target = elements[(raw as any).$ref];
      if (!target || !target.$instanceOf(reference.property.type)) throw new Error(`BPMN 引用不存在或类型不相容：${(raw as any).$ref}`);
      resolvedReferences.push({ element: reference.owner, property: reference.property.ns.name, id: target.id });
      return target;
    };
    if (reference.property.isMany) {
      if (!Array.isArray(reference.value)) throw new Error('BPMN 多值引用必须是列表');
      reference.owner.set(reference.property.name, reference.value.map(resolve));
    } else reference.owner.set(reference.property.name, resolve(reference.value));
  }
  return { definition: { format: BPMN_FORMAT, model: dehydrateWorkflowBpmn(root) }, root, elements, references: resolvedReferences, processes: (root.rootElements ?? []).filter((item: WorkflowBpmnElement) => item.$type === 'bpmn:Process') };
}

/**
 * 将内存元模型转成可持久化对象，引用保存元素标识，避免循环引用和重复权威数据。
 * @param element - 待保存的标准元模型元素。
 * @returns 只包含标准属性、命名空间扩展和显式引用的普通对象。
 * @throws 引用元素没有标识时拒绝保存。
 */
export function dehydrateWorkflowBpmn(element: WorkflowBpmnElement): WorkflowBpmnRecord {
  const record: WorkflowBpmnRecord = { $type: element.$type };
  for (const property of element.$descriptor.properties) {
    if (property.isVirtual || !Object.hasOwn(element, property.name)) continue;
    const value = element.get(property.name);
    if (value === undefined) continue;
    const flatten = (item: any): unknown => {
      if (property.isReference) {
        if (!item?.id) throw new Error('BPMN 引用元素必须具有标识');
        return { $ref: item.id };
      }
      if (item && typeof item === 'object') return dehydrateWorkflowBpmn(item);
      return item;
    };
    if (Array.isArray(value)) record[property.name] = value.map(flatten);
    else record[property.name] = flatten(value);
  }
  return record;
}

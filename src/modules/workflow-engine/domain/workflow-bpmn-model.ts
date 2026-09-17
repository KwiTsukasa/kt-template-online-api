/// <reference types="../contract/bpmn-moddle" />
import * as BpmnModdle from 'bpmn-moddle';
import { FORBIDDEN_OBJECT_KEYS } from '@/common/automation/constants/identity';
import { definitionRecord } from '@/common/automation/definition.types';
import {
  rejectDefinition,
  requireDefinition,
} from '@/common/automation/validation';
import {
  BPMN_FORMAT,
  BPMN_MODEL_ERROR,
  BPMN_MODEL_PATTERN,
  BPMN_PROPERTY_TYPE,
  BPMN_TYPE,
  KT_BPMN_MODDLE,
  WORKFLOW_BPMN_LIMITS,
} from '../constants/bpmn';
import type {
  WorkflowBpmnElement,
  WorkflowBpmnModel,
  WorkflowBpmnProperty,
  WorkflowBpmnRecord,
} from '../contract/workflow-bpmn.types';

type PropertyAssignment = {
  property: WorkflowBpmnProperty;
  value: unknown;
  slot?: { values: unknown[]; index: number };
};
type RestoreFrame = {
  element: WorkflowBpmnElement;
  assignments: PropertyAssignment[];
  position: number;
  depth: number;
};
type PendingReference = {
  owner: WorkflowBpmnElement;
  property: WorkflowBpmnProperty;
  value: unknown;
};

/**
 * 在 JSON 边界核对格式与大小，再用显式工作栈恢复标准元素和引用，全程不经过 XML。
 * @param input - 带标准类型、属性和引用的流程文档。
 * @returns 保持规范化字段顺序和引用身份的标准内存模型。
 * @throws 文档、属性、引用或模型规模不符合工作流契约时拒绝恢复。
 */
export function hydrateWorkflowBpmn(input: unknown): WorkflowBpmnModel {
  const source = definitionRecord(input, BPMN_MODEL_ERROR.document);
  requireDefinition(
    source.format === BPMN_FORMAT &&
      source.model &&
      typeof source.model === 'object' &&
      !Object.hasOwn(source, 'xml'),
    BPMN_MODEL_ERROR.document,
  );
  requireDefinition(
    Buffer.byteLength(JSON.stringify(source.model), 'utf8') <=
      WORKFLOW_BPMN_LIMITS.modelBytes,
    BPMN_MODEL_ERROR.size,
  );
  return new WorkflowModelRestorer().restore(source.model);
}

class WorkflowModelRestorer {
  private readonly moddle = new BpmnModdle({ kt: KT_BPMN_MODDLE });
  private readonly elements: Record<string, WorkflowBpmnElement> =
    Object.create(null);
  private readonly references: PendingReference[] = [];
  private readonly resolvedReferences: WorkflowBpmnModel['references'] = [];
  private count = 0;

  /**
   * 以深度优先工作栈写入属性并在元素结束时登记身份，保留原有规范化顺序，引用在元素齐备后解析。
   * @param raw - 文档的标准模型根记录。
   * @returns 可执行元模型、引用索引与规范化 JSON，输入对象保持不变。
   */
  restore(raw: unknown): WorkflowBpmnModel {
    const first = this.frame(raw, undefined, 0);
    const pending = [first];
    while (pending.length) {
      const current = pending[pending.length - 1];
      const assignment = current.assignments[current.position++];
      if (!assignment) {
        this.registerIdentity(current.element);
        pending.pop();
        continue;
      }
      if (assignment.property.isReference) {
        this.references.push({
          owner: current.element,
          property: assignment.property,
          value: assignment.value,
        });
        continue;
      }
      let value: unknown;
      if (assignment.value && typeof assignment.value === 'object') {
        const child = this.frame(
          assignment.value,
          current.element,
          current.depth + 1,
        );
        requireDefinition(
          assignment.property.type === BPMN_PROPERTY_TYPE.element ||
            child.element.$instanceOf(assignment.property.type),
          `${assignment.property.name} ${BPMN_MODEL_ERROR.child}`,
        );
        pending.push(child);
        value = child.element;
      } else value = this.scalar(assignment.property, assignment.value);
      if (assignment.slot)
        assignment.slot.values[assignment.slot.index] = value;
      else current.element.set(assignment.property.name, value);
    }
    const root = first.element;
    requireDefinition(
      root.$type === BPMN_TYPE.Definitions,
      BPMN_MODEL_ERROR.root,
    );
    for (const reference of this.references) this.resolveReference(reference);
    const roots = (root.get('rootElements') ?? []) as WorkflowBpmnElement[];
    return {
      definition: { format: BPMN_FORMAT, model: dehydrateWorkflowBpmn(root) },
      root,
      elements: this.elements,
      references: this.resolvedReferences,
      processes: roots.filter((element) => element.$type === BPMN_TYPE.Process),
    };
  }

  /**
   * 为单个元素准备属性作业，直接复用元模型已有属性索引，多值属性的每个值只产生一个作业。
   * @param raw - 尚未恢复的标准元素记录。
   * @param parent - 拥有该元素的父元素；根元素为空。
   * @param depth - 标准模型的实际包含深度。
   * @returns 已分配元素与按输入顺序排列的属性作业。
   */
  private frame(
    raw: unknown,
    parent: WorkflowBpmnElement | undefined,
    depth: number,
  ): RestoreFrame {
    const record = definitionRecord(raw, BPMN_MODEL_ERROR.structure);
    requireDefinition(
      depth <= WORKFLOW_BPMN_LIMITS.modelDepth &&
        ++this.count <= WORKFLOW_BPMN_LIMITS.modelElements,
      BPMN_MODEL_ERROR.structure,
    );
    requireDefinition(
      typeof record.$type === 'string' &&
        BPMN_MODEL_PATTERN.type.test(record.$type),
      BPMN_MODEL_ERROR.type,
    );
    let element: WorkflowBpmnElement;
    try {
      element = this.moddle.create(record.$type) as WorkflowBpmnElement;
    } catch (error) {
      rejectDefinition(String(error));
    }
    if (parent) element.$parent = parent;
    const properties = element.$descriptor.propertiesByName;
    const assignments: PropertyAssignment[] = [];
    for (const [name, value] of Object.entries(record)) {
      if (name === '$type') continue;
      requireDefinition(
        !FORBIDDEN_OBJECT_KEYS.has(name),
        BPMN_MODEL_ERROR.property,
      );
      const property = properties[name];
      requireDefinition(
        Object.hasOwn(properties, name) &&
          property.name === name &&
          !property.isVirtual,
        `${record.$type} ${BPMN_MODEL_ERROR.undeclared} ${name}`,
      );
      if (property.isReference || !property.isMany) {
        assignments.push({ property, value });
        continue;
      }
      requireDefinition(
        Array.isArray(value),
        `${name} ${BPMN_MODEL_ERROR.list}`,
      );
      const values = new Array<unknown>(value.length);
      element.set(name, values);
      for (let index = 0; index < value.length; index++)
        assignments.push({
          property,
          value: value[index],
          slot: { values, index },
        });
    }
    return { element, assignments, position: 0, depth };
  }

  /**
   * 严格读取标准标量，元模型中的布尔与数字不接受文本转换，属性或正文仍只接受文本。
   * @param property - 当前标准属性的类型及声明方式。
   * @param value - 待写入的原始标量。
   * @returns 校验后的布尔、有限数字或文本。
   */
  private scalar(
    property: WorkflowBpmnProperty,
    value: unknown,
  ): boolean | number | string {
    const { name, type } = property;
    if (type === BPMN_PROPERTY_TYPE.boolean) {
      requireDefinition(
        typeof value === 'boolean',
        `${name} ${BPMN_MODEL_ERROR.boolean}`,
      );
      return value;
    }
    if (
      type === BPMN_PROPERTY_TYPE.integer ||
      type === BPMN_PROPERTY_TYPE.real
    ) {
      requireDefinition(
        typeof value === 'number' && Number.isFinite(value),
        `${name} ${BPMN_MODEL_ERROR.finite}`,
      );
      requireDefinition(
        type !== BPMN_PROPERTY_TYPE.integer || Number.isSafeInteger(value),
        `${name} ${BPMN_MODEL_ERROR.integer}`,
      );
      return value;
    }
    requireDefinition(
      (type === BPMN_PROPERTY_TYPE.string ||
        property.isAttr ||
        property.isBody) &&
        typeof value === 'string',
      `${name} ${BPMN_MODEL_ERROR.scalar}`,
    );
    return value as string;
  }

  /**
   * 在元素属性齐备后登记唯一身份，匿名标准元素不进入引用索引。
   * @param element - 已完成属性恢复的元素。
   */
  private registerIdentity(element: WorkflowBpmnElement): void {
    if (element.id === undefined) return;
    requireDefinition(
      typeof element.id === 'string' &&
        BPMN_MODEL_PATTERN.id.test(element.id) &&
        !Object.hasOwn(this.elements, element.id),
      BPMN_MODEL_ERROR.identity,
    );
    this.elements[element.id] = element;
  }

  /**
   * 通过统一身份索引解析单值或多值引用，校验结果同时写入元素和引擎引用表。
   * @param reference - 元素恢复期间保留的引用属性及原始值。
   */
  private resolveReference(reference: PendingReference): void {
    const resolve = (raw: unknown): WorkflowBpmnElement => {
      const value = definitionRecord(raw, BPMN_MODEL_ERROR.reference);
      requireDefinition(
        Object.keys(value).length === 1 && typeof value.$ref === 'string',
        BPMN_MODEL_ERROR.reference,
      );
      const target = this.elements[value.$ref];
      requireDefinition(
        target && target.$instanceOf(reference.property.type),
        `${BPMN_MODEL_ERROR.referenceType}${value.$ref}`,
      );
      this.resolvedReferences.push({
        element: reference.owner,
        property: reference.property.ns.name,
        id: target.id,
      });
      return target;
    };
    if (!reference.property.isMany) {
      reference.owner.set(reference.property.name, resolve(reference.value));
      return;
    }
    requireDefinition(
      Array.isArray(reference.value),
      BPMN_MODEL_ERROR.referenceList,
    );
    reference.owner.set(reference.property.name, reference.value.map(resolve));
  }
}

/**
 * 将内存元模型转成可持久化对象，引用保存元素标识，避免循环引用和重复权威数据。
 * @param element - 待保存的标准元模型元素。
 * @returns 只包含标准属性、命名空间扩展和显式引用的普通对象。
 * @throws 引用元素没有标识时拒绝保存。
 */
export function dehydrateWorkflowBpmn(
  element: WorkflowBpmnElement,
): WorkflowBpmnRecord {
  const record: WorkflowBpmnRecord = { $type: element.$type };
  for (const property of element.$descriptor.properties) {
    if (property.isVirtual || !Object.hasOwn(element, property.name)) continue;
    const value = element.get(property.name);
    if (value === undefined) continue;
    const flatten = (item: unknown): unknown => {
      if (property.isReference) {
        const target = item as WorkflowBpmnElement;
        requireDefinition(target?.id, BPMN_MODEL_ERROR.referenceId);
        return { $ref: target.id };
      }
      if (item && typeof item === 'object')
        return dehydrateWorkflowBpmn(item as WorkflowBpmnElement);
      return item;
    };
    if (Array.isArray(value)) record[property.name] = value.map(flatten);
    else record[property.name] = flatten(value);
  }
  return record;
}

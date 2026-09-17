import { BPMN_KIND_GROUPS, BPMN_TYPE } from '../constants/bpmn';
import type {
  WorkflowBpmnElement,
  WorkflowBpmnModel,
} from '../contract/workflow-bpmn.types';

/**
 * 在所属节点的索引桶中追加引用，未填写的草稿端点交由校验器报告。
 * @param index - 按所属元素分组的索引。
 * @param owner - 连线、参与者或关联的所属元素。
 * @param element - 本次需要保留的标准元素。
 */
function appendBpmnIndex(
  index: Map<WorkflowBpmnElement, WorkflowBpmnElement[]>,
  owner: WorkflowBpmnElement | undefined,
  element: WorkflowBpmnElement,
): void {
  if (!owner) return;
  const rows = index.get(owner) ?? [];
  rows.push(element);
  index.set(owner, rows);
}

export class WorkflowBpmnModelIndex {
  readonly elements: WorkflowBpmnElement[];
  readonly outgoing = new Map<WorkflowBpmnElement, WorkflowBpmnElement[]>();
  readonly incoming = new Map<WorkflowBpmnElement, WorkflowBpmnElement[]>();
  readonly incomingSources = new Map<
    WorkflowBpmnElement,
    Set<WorkflowBpmnElement>
  >();
  readonly participants = new Map<WorkflowBpmnElement, WorkflowBpmnElement[]>();
  readonly associations = new Map<WorkflowBpmnElement, WorkflowBpmnElement[]>();
  readonly boundaryHosts = new Set<WorkflowBpmnElement>();
  readonly events = new Map<
    WorkflowBpmnElement,
    { types: Set<string>; gatewayAllowed: boolean }
  >();
  readonly processIds: Set<string>;
  private readonly processAncestors = new Map<
    WorkflowBpmnElement,
    WorkflowBpmnElement | undefined
  >();
  private readonly containerAncestors = new Map<
    WorkflowBpmnElement,
    WorkflowBpmnElement | undefined
  >();

  constructor(model: WorkflowBpmnModel) {
    this.elements = Object.values(model.elements);
    this.processIds = new Set(model.processes.map((process) => process.id));
    for (const element of this.elements) {
      if (element.$type === BPMN_TYPE.SequenceFlow) {
        appendBpmnIndex(this.outgoing, element.sourceRef, element);
        appendBpmnIndex(this.incoming, element.targetRef, element);
        const sources =
          this.incomingSources.get(element.targetRef) ?? new Set();
        sources.add(element.sourceRef);
        this.incomingSources.set(element.targetRef, sources);
      }
      if (element.$type === BPMN_TYPE.Participant)
        appendBpmnIndex(this.participants, element.processRef, element);
      if (element.$type === BPMN_TYPE.Association)
        appendBpmnIndex(this.associations, element.sourceRef, element);
      if (element.$type === BPMN_TYPE.BoundaryEvent && element.attachedToRef)
        this.boundaryHosts.add(element.attachedToRef);
      const definitions: WorkflowBpmnElement[] = [
        ...(element.eventDefinitions ?? []),
        ...(element.eventDefinitionRef ?? []),
      ];
      const types = new Set(definitions.map((definition) => definition.$type));
      this.events.set(element, {
        types,
        gatewayAllowed:
          definitions.length > 0 &&
          definitions.every((definition) =>
            BPMN_KIND_GROUPS.eventGatewayTriggers.has(definition.$type),
          ),
      });
    }
  }

  /**
   * 查询端点所属参与者，祖先查找结果按元素缓存，每个祖先在同一校验批次最多访问一次。
   * @param element - 消息流端点。
   * @returns 所属参与者；未归属协作泳池时为空。
   */
  participant(element?: WorkflowBpmnElement): WorkflowBpmnElement | undefined {
    if (!element) return undefined;
    if (element.$type === BPMN_TYPE.Participant) return element;
    const process = this.nearest(
      element,
      BPMN_TYPE.Process,
      this.processAncestors,
    );
    return this.participants.get(process)?.[0];
  }

  /**
   * 定位元素所属流程容器，嵌套泳道共用已经计算的祖先结果。
   * @param element - 需要核对所属流程或子流程的元素。
   * @returns 最近的外层流程容器。
   */
  scope(element: WorkflowBpmnElement): WorkflowBpmnElement | undefined {
    return this.nearest(
      element.$parent,
      BPMN_TYPE.FlowElementsContainer,
      this.containerAncestors,
    );
  }

  /**
   * 用路径压缩缓存最近的指定类型祖先，命中缓存后不再遍历共有父链。
   * @param element - 本次查找起点。
   * @param type - 要匹配的标准元模型类型。
   * @param cache - 该类型的本批祖先缓存，包含已经确认没有祖先的元素。
   * @returns 最近匹配的祖先或空值。
   */
  private nearest(
    element: WorkflowBpmnElement | undefined,
    type: string,
    cache: Map<WorkflowBpmnElement, WorkflowBpmnElement | undefined>,
  ): WorkflowBpmnElement | undefined {
    const path: WorkflowBpmnElement[] = [];
    let current = element;
    while (current && !cache.has(current)) {
      if (current.$instanceOf(type)) {
        cache.set(current, current);
        break;
      }
      path.push(current);
      current = current.$parent;
    }
    const match = cache.get(current);
    for (const child of path) cache.set(child, match);
    return match;
  }
}

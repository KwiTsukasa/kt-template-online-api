import { isDeepStrictEqual } from 'node:util';
import { automationDigest } from '../../common/automation/content-digest';
import type { PublishedReference } from '../../common/automation/definition.types';
import { normalizeFormDefinition } from '../../modules/form-definition/domain/form.policy';
import { normalizeRuleDefinition } from '../../modules/rule-engine/domain/rule.policy';
import {
  BPMN_TYPE,
  KT_BPMN_EXPRESSION,
  KT_BPMN_STEP,
} from '../../modules/workflow-engine/constants/bpmn';
import type {
  WorkflowBpmnDefinition,
  WorkflowBpmnRecord,
} from '../../modules/workflow-engine/contract/workflow-bpmn.types';
import {
  parseWorkflowBpmn,
  validateWorkflowBpmn,
} from '../../modules/workflow-engine/domain/workflow-bpmn.policy';
import {
  normalizeWorkflowDocument,
  readBpmnContract,
  readBpmnStep,
} from '../../modules/workflow-engine/domain/workflow-document.policy';

export const MEDIA_FORM_SOURCE = 'media.governance.v1:form:source.review';
export const MEDIA_RULE_SOURCE = 'media.governance.v1:rule:source-missing';
export const MEDIA_FORM_NAME = '媒体来源资料确认';
export const MEDIA_RULE_NAME = '媒体来源补充判断';
export const MEDIA_FORM = normalizeFormDefinition({
  schemaVersion: 1,
  dataSchema: {
    fields: [
      {
        key: 'confirmed',
        label: '已补充并确认来源资料',
        type: 'boolean',
        required: true,
        options: [{ label: '已确认', value: true }],
      },
    ],
  },
  uiSchema: {
    columns: 1,
    fields: [
      {
        key: 'confirmed',
        component: 'Switch',
        span: 1,
        placeholder: '',
        help: '先在媒体任务中补齐来源，再确认已保存的来源资料。',
      },
    ],
  },
});
export const MEDIA_RULE = normalizeRuleDefinition({
  schemaVersion: 1,
  factSchema: {
    fields: [
      {
        key: 'sourceCount',
        label: '来源数量',
        type: 'integer',
        required: true,
        min: 0,
        max: 16,
      },
    ],
  },
  mode: 'condition',
  condition: { type: 'compare', path: 'sourceCount', operator: 'eq', value: 0 },
  testCases: [
    { name: '未保存来源时需要补充', facts: { sourceCount: 0 }, expected: true },
    {
      name: '已有一个来源时直接检查',
      facts: { sourceCount: 1 },
      expected: false,
    },
    {
      name: '来源数量上限直接检查',
      facts: { sourceCount: 16 },
      expected: false,
    },
  ],
});
const SOURCE_CONDITION = {
  op: 'eq',
  left: { path: 'input.sourceCount' },
  right: { value: 0 },
};
const RULE_NODE = 'MediaSourceMissingRule';
const RULE_FLOW = 'MediaSourceMissingRule_Gateway';
type RecordNode = WorkflowBpmnRecord & { id: string };
type Match = {
  process: RecordNode;
  elements: RecordNode[];
  human: RecordNode;
  gateway: RecordNode;
  incoming: RecordNode;
  branch: RecordNode;
};

/**
 * 对数据库 JSON 递归排序对象键，避免 MySQL 重排键名导致预演与应用摘要不一致。
 * @param value - 待密封的完整 JSON 内容。
 * @returns 排序对象键后的 JSON 值，数组顺序和字符串内容不变。
 */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

/**
 * 密封完整定义或目标快照，包含未改动的脚本、循环和布局内容。
 * @param value - 已读取的 JSON 数据。
 * @returns 不受对象键存储顺序影响的完整内容摘要。
 */
export function designResourceDigest(value: unknown): string {
  return automationDigest(JSON.stringify(canonical(value)));
}

/**
 * 拒绝不符合已知媒体转换边界的结构，避免猜测用户自定义流程。
 * @param valid - 精确结构检查的结果。
 * @param message - 可定位的拒绝原因。
 * @throws 结构不匹配时停止转换。
 */
function expectStructure(valid: unknown, message: string): asserts valid {
  if (!valid) throw new Error(`媒体资源抽离拒绝：${message}`);
}

/**
 * 从序列化节点读取唯一的 KT 步骤扩展，保留其他扩展与原始正文。
 * @param node - 待修改的人工或规则任务。
 * @returns 当前节点唯一的步骤扩展记录。
 * @throws 缺失或重复步骤扩展时拒绝转换。
 */
function stepExtension(node: RecordNode): WorkflowBpmnRecord {
  const extension = node.extensionElements as { values: WorkflowBpmnRecord[] };
  const values =
    extension?.values?.filter((item) => item.$type === 'kt:Step') ?? [];
  expectStructure(values.length === 1, '步骤扩展缺失或重复');
  return values[0];
}

/**
 * 识别创建后先判断来源、可选人工补充再进入既有五步媒体链的唯一结构。
 * @param definition - 已发布且未改动的标准媒体图。
 * @returns 在克隆图中的人工节点、网关和需要分拆的入口连线。
 * @throws 身份、分支、连线、业务链或条件存在未知结构时拒绝转换。
 */
async function matchOriginal(
  definition: WorkflowBpmnDefinition,
): Promise<Match> {
  const parsed = await parseWorkflowBpmn(definition);
  const contract = readBpmnContract(parsed);
  expectStructure(
    isDeepStrictEqual(contract.processRef, {
      key: 'media.governance',
      version: 1,
    }) &&
      !contract.formRef &&
      !Object.keys(contract.formMapping).length,
    '只转换 media.governance@1 节点表单',
  );
  expectStructure(
    parsed.processes.length === 1 && parsed.processes[0].isExecutable,
    '只能有一个可执行媒体流程',
  );
  expectStructure(!validateWorkflowBpmn(parsed).length, '原图 BPMN 校验失败');
  const process = (definition.model.rootElements as RecordNode[]).find(
    (item) => item.$type === BPMN_TYPE.Process,
  )!;
  const elements = process.flowElements as RecordNode[];
  const nodes = elements.filter(
    (item) => item.$type !== BPMN_TYPE.SequenceFlow,
  );
  const flows = elements.filter(
    (item) => item.$type === BPMN_TYPE.SequenceFlow,
  );
  expectStructure(
    nodes.length === 9 && flows.length === 9,
    '已知媒体链的节点或连线数量已变化',
  );
  const humans = nodes.filter(
    (item) => readBpmnStep(parsed.elements[item.id])?.kind === 'human',
  );
  expectStructure(humans.length === 1, '人工来源确认必须唯一');
  const human = humans[0];
  expectStructure(
    isDeepStrictEqual(readBpmnStep(parsed.elements[human.id]), {
      kind: 'human',
      businessKey: 'source.review',
      formRef: null,
      writableFields: [],
      input: {},
    }) && !human.loopCharacteristics,
    '来源确认已配置表单、字段或循环',
  );
  const starts = nodes.filter((item) => item.$type === BPMN_TYPE.StartEvent);
  const gateways = nodes.filter(
    (item) => item.$type === 'bpmn:ExclusiveGateway',
  );
  const ends = nodes.filter((item) => item.$type === BPMN_TYPE.EndEvent);
  expectStructure(
    starts.length === 1 &&
      gateways.length === 1 &&
      ends.length === 1 &&
      !starts[0].eventDefinitions &&
      !ends[0].eventDefinitions,
    '入口、网关或终点结构未知',
  );
  const gateway = gateways[0];
  const incoming = flows.filter(
    (item) => (item.targetRef as { $ref: string }).$ref === gateway.id,
  );
  const outgoing = flows.filter(
    (item) => (item.sourceRef as { $ref: string }).$ref === gateway.id,
  );
  expectStructure(
    incoming.length === 1 &&
      (incoming[0].sourceRef as { $ref: string }).$ref === starts[0].id &&
      !incoming[0].conditionExpression &&
      outgoing.length === 2,
    '来源网关必须由唯一创建入口支配',
  );
  const branch = outgoing.find(
    (item) => (item.targetRef as { $ref: string }).$ref === human.id,
  );
  const fallback = outgoing.find(
    (item) => item.id === (gateway.default as { $ref?: string })?.$ref,
  );
  expectStructure(
    branch && fallback && fallback !== branch && !fallback.conditionExpression,
    '来源网关的人工分支或默认出口已变化',
  );
  expectStructure(
    isDeepStrictEqual(branch.conditionExpression, {
      $type: 'bpmn:FormalExpression',
      language: KT_BPMN_EXPRESSION,
      body: JSON.stringify(SOURCE_CONDITION),
    }),
    '仅支持明确 input.sourceCount 等于零的分支',
  );
  const chainKeys = [
    'source.inspect',
    'source.probe-runtime',
    'source.download',
    'governance.execute',
    'acceptance.verify',
  ];
  const chain = chainKeys.map((key) => {
    const matched = nodes.filter((item) => {
      const step = readBpmnStep(parsed.elements[item.id]);
      return step?.kind === 'business' && step.stepKey === key;
    });
    expectStructure(matched.length === 1, `业务步骤 ${key} 必须唯一`);
    return matched[0];
  });
  expectStructure(
    (fallback.targetRef as { $ref: string }).$ref === chain[0].id,
    '默认出口必须进入来源检查',
  );
  const expected = [
    [starts[0], gateway],
    [gateway, human],
    [gateway, chain[0]],
    [human, chain[0]],
    ...chain.map((item, index) => [item, [...chain, ends[0]][index + 1]]),
  ];
  expectStructure(
    flows.every((item) =>
      expected.some(
        ([source, target]) =>
          (item.sourceRef as { $ref: string }).$ref === source.id &&
          (item.targetRef as { $ref: string }).$ref === target.id,
      ),
    ) &&
      expected.every(
        ([source, target]) =>
          flows.filter(
            (item) =>
              (item.sourceRef as { $ref: string }).$ref === source.id &&
              (item.targetRef as { $ref: string }).$ref === target.id,
          ).length === 1,
      ),
    '业务链存在绕行、重复或额外入口',
  );
  expectStructure(
    flows.every((item) => item === branch || !item.conditionExpression),
    '其他连线包含未知分支条件',
  );
  expectStructure(
    !parsed.elements[RULE_NODE] &&
      !parsed.elements[RULE_FLOW] &&
      !parsed.elements[`${RULE_NODE}_di`] &&
      !parsed.elements[`${RULE_FLOW}_di`],
    '新增规则节点身份已被占用',
  );
  return { process, elements, human, gateway, incoming: incoming[0], branch };
}

/**
 * 把来源确认和零来源分支改为固定的公用表单、规则引用，保留业务脚本和原布局。
 * @param source - 原始发布定义，不在原对象上修改。
 * @param references - 将插入或复用的表单、规则首个固定发布版本。
 * @returns 可保存的新工作流定义。
 * @throws 未知媒体结构、资源身份或转换后 BPMN 校验失败时拒绝转换。
 */
export async function extractMediaDesignResources(
  source: WorkflowBpmnDefinition,
  references: { form: PublishedReference; rule: PublishedReference },
): Promise<WorkflowBpmnDefinition> {
  const definition = structuredClone(source);
  const matched = await matchOriginal(definition);
  const human = JSON.parse(String(stepExtension(matched.human).body));
  human.formRef = references.form;
  human.writableFields = ['confirmed'];
  stepExtension(matched.human).body = JSON.stringify(human);
  matched.incoming.targetRef = { $ref: RULE_NODE };
  matched.branch.conditionExpression = {
    ...(matched.branch.conditionExpression as WorkflowBpmnRecord),
    body: JSON.stringify({ path: `outputs.${RULE_NODE}.result` }),
  };
  matched.elements.push(
    {
      $type: BPMN_TYPE.BusinessRuleTask,
      id: RULE_NODE,
      name: MEDIA_RULE_NAME,
      implementation: KT_BPMN_STEP,
      extensionElements: {
        $type: 'bpmn:ExtensionElements',
        values: [
          {
            $type: 'kt:Step',
            body: JSON.stringify({
              kind: 'rule',
              ruleRef: references.rule,
              input: { sourceCount: { type: 'input', field: 'sourceCount' } },
            }),
          },
        ],
      },
    },
    {
      $type: BPMN_TYPE.SequenceFlow,
      id: RULE_FLOW,
      sourceRef: { $ref: RULE_NODE },
      targetRef: { $ref: matched.gateway.id },
    },
  );
  const diagrams = definition.model.diagrams as
    | Array<{
        plane: {
          bpmnElement: { $ref: string };
          planeElement: WorkflowBpmnRecord[];
        };
      }>
    | undefined;
  for (const diagram of diagrams ?? []) {
    if (diagram.plane.bpmnElement.$ref !== matched.process.id) continue;
    const gatewayShape = diagram.plane.planeElement.find(
      (item) =>
        (item.bpmnElement as { $ref?: string })?.$ref === matched.gateway.id,
    );
    const bounds = gatewayShape?.bounds as
      | { x: number; y: number; width: number; height: number }
      | undefined;
    expectStructure(bounds, '已有媒体画布缺少来源网关布局');
    const x = bounds.x + bounds.width + 70;
    const y = bounds.y;
    diagram.plane.planeElement.push(
      {
        $type: 'bpmndi:BPMNShape',
        id: `${RULE_NODE}_di`,
        bpmnElement: { $ref: RULE_NODE },
        bounds: { $type: 'dc:Bounds', x, y, width: 180, height: 76 },
      },
      {
        $type: 'bpmndi:BPMNEdge',
        id: `${RULE_FLOW}_di`,
        bpmnElement: { $ref: RULE_FLOW },
        waypoint: [
          { $type: 'dc:Point', x, y: y + 38 },
          {
            $type: 'dc:Point',
            x: bounds.x + bounds.width,
            y: bounds.y + bounds.height / 2,
          },
        ],
      },
    );
    const entryEdge = diagram.plane.planeElement.find(
      (item) =>
        (item.bpmnElement as { $ref?: string })?.$ref === matched.incoming.id,
    );
    if (entryEdge) {
      const waypoints = entryEdge.waypoint as WorkflowBpmnRecord[];
      expectStructure(waypoints?.length >= 2, '媒体入口连线布局无效');
      waypoints[waypoints.length - 1] = { $type: 'dc:Point', x: x + 90, y };
    }
  }
  const normalized = (await normalizeWorkflowDocument(
    definition,
  )) as WorkflowBpmnDefinition;
  expectStructure(
    !validateWorkflowBpmn(await parseWorkflowBpmn(normalized)).length,
    '转换后的 BPMN 校验失败',
  );
  return normalized;
}

/**
 * 对已抽离图逆向还原匹配区域并再次正向转换，只接受本命令完整生成的引用结构。
 * @param definition - 当前草稿与发布内容一致的定义。
 * @param references - 来源唯一且未经用户修改的公用资源引用。
 * @returns 是否为已完成抽离的精确结构，原图返回假。
 * @throws 看似已迁移但节点、引用或分支被修改时拒绝重复应用。
 */
export async function isExtractedMediaDefinition(
  definition: WorkflowBpmnDefinition,
  references: { form: PublishedReference; rule: PublishedReference },
): Promise<boolean> {
  const original = structuredClone(definition);
  const parsed = await parseWorkflowBpmn(original);
  if (!parsed.elements[RULE_NODE]) return false;
  const process = (original.model.rootElements as RecordNode[]).find(
    (item) => item.$type === BPMN_TYPE.Process,
  );
  expectStructure(process, '已迁移流程入口缺失');
  const elements = process.flowElements as RecordNode[];
  const rule = elements.find((item) => item.id === RULE_NODE)!;
  expectStructure(
    isDeepStrictEqual(readBpmnStep(parsed.elements[RULE_NODE]), {
      kind: 'rule',
      ruleRef: references.rule,
      input: { sourceCount: { type: 'input', field: 'sourceCount' } },
    }),
    '已有规则引用或事实映射已修改',
  );
  const ruleFlow = elements.find((item) => item.id === RULE_FLOW);
  const incoming = elements.filter(
    (item) =>
      item.$type === BPMN_TYPE.SequenceFlow &&
      (item.targetRef as { $ref: string }).$ref === RULE_NODE,
  );
  expectStructure(
    ruleFlow &&
      incoming.length === 1 &&
      (ruleFlow.sourceRef as { $ref: string }).$ref === RULE_NODE,
    '已迁移规则连线已修改',
  );
  incoming[0].targetRef = structuredClone(ruleFlow.targetRef);
  const humanNodes = elements.filter(
    (item) => readBpmnStep(parsed.elements[item.id])?.kind === 'human',
  );
  expectStructure(humanNodes.length === 1, '已迁移人工节点不唯一');
  const human = humanNodes[0];
  expectStructure(
    isDeepStrictEqual(readBpmnStep(parsed.elements[human.id]), {
      kind: 'human',
      businessKey: 'source.review',
      formRef: references.form,
      writableFields: ['confirmed'],
      input: {},
    }),
    '已有表单引用或字段授权已修改',
  );
  stepExtension(human).body = JSON.stringify({
    kind: 'human',
    businessKey: 'source.review',
    formRef: null,
    writableFields: [],
    input: {},
  });
  const branch = elements.find(
    (item) =>
      item.$type === BPMN_TYPE.SequenceFlow &&
      (item.targetRef as { $ref: string }).$ref === human.id,
  )!;
  expectStructure(
    isDeepStrictEqual(branch?.conditionExpression, {
      $type: 'bpmn:FormalExpression',
      language: KT_BPMN_EXPRESSION,
      body: JSON.stringify({ path: `outputs.${RULE_NODE}.result` }),
    }),
    '已有规则结果分支已修改',
  );
  branch.conditionExpression = {
    ...(branch.conditionExpression as WorkflowBpmnRecord),
    body: JSON.stringify(SOURCE_CONDITION),
  };
  process.flowElements = elements.filter(
    (item) => item !== rule && item !== ruleFlow,
  );
  for (const diagram of (original.model.diagrams as
    | Array<{ plane: { planeElement: WorkflowBpmnRecord[] } }>
    | undefined) ?? []) {
    diagram.plane.planeElement = diagram.plane.planeElement.filter(
      (item) => item.id !== `${RULE_NODE}_di` && item.id !== `${RULE_FLOW}_di`,
    );
  }
  const regenerated = await extractMediaDesignResources(original, references);
  expectStructure(
    designResourceDigest(regenerated) === designResourceDigest(definition),
    '已迁移图存在未识别的抽离结构漂移',
  );
  return true;
}

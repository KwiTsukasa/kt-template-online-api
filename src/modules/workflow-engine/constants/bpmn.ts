export const BPMN_FORMAT = 'bpmn20' as const;

export const KT_BPMN_NAMESPACE =
  'https://kwitsukasa.top/schema/workflow/bpmn/1';

export const KT_BPMN_EXPRESSION = `${KT_BPMN_NAMESPACE}/expression`;

export const KT_BPMN_STEP = `${KT_BPMN_NAMESPACE}/step`;

export const KT_BPMN_MODDLE = {
  name: 'KtWorkflow',
  uri: KT_BPMN_NAMESPACE,
  prefix: 'kt',
  xml: { tagAlias: 'lowerCase' },
  types: [
    {
      name: 'Contract',
      superClass: ['Element'],
      properties: [{ name: 'body', type: 'String', isBody: true }],
    },
    {
      name: 'Step',
      superClass: ['Element'],
      properties: [{ name: 'body', type: 'String', isBody: true }],
    },
  ],
};

export const WORKFLOW_BPMN_LIMITS = Object.freeze({
  modelIdentityLength: 191,
  executionIdentityLength: 512,
  maxInstances: 1000,
  synchronousTransitions: 10000,
  expressionDepth: 16,
  expressionOperands: 32,
  prioritySources: 8,
  modelBytes: 2 * 1024 * 1024,
  modelDepth: 32,
  modelElements: 4096,
});

export const BPMN_MODEL_PATTERN = {
  type: /^(bpmn|bpmndi|dc|di|kt):/,
  id: /^[\p{L}_][\p{L}\p{M}\p{N}_.-]{0,190}$/u,
} as const;
export const WORKFLOW_BINDING_FIELD_PATTERN =
  /^[A-Za-z0-9_][A-Za-z0-9_-]{0,63}$/;
export const BPMN_EXPRESSION_CONTEXTS: ReadonlySet<string> = new Set([
  'input',
  'outputs',
  'variables',
  'content',
]);
export const BPMN_EXPRESSION_SEGMENT = /^[A-Za-z0-9_-]+$/;

export const BPMN_PROPERTY_TYPE = {
  element: 'Element',
  boolean: 'Boolean',
  integer: 'Integer',
  real: 'Real',
  string: 'String',
} as const;

export const BPMN_MODEL_ERROR = {
  document: '工作流内部定义必须使用结构化 BPMN 模型',
  size: 'BPMN 模型不能超过 2 MiB',
  structure: 'BPMN 元素结构或规模无效',
  type: 'BPMN 元素类型不支持',
  property: 'BPMN 模型包含不允许的属性',
  identity: 'BPMN 元素标识无效或重复',
  root: 'BPMN 模型根节点必须是 Definitions',
  reference: 'BPMN 引用必须包含唯一的 $ref 标识',
  referenceList: 'BPMN 多值引用必须是列表',
  referenceId: 'BPMN 引用元素必须具有标识',
  list: '必须是列表',
  boolean: '必须是布尔值',
  finite: '必须是有限数值',
  integer: '必须是整数',
  scalar: '的标准属性值类型不合法',
  child: '的元素类型不相容',
  undeclared: '不存在标准属性',
  referenceType: 'BPMN 引用不存在或类型不相容：',
} as const;

export const BPMN_CONDITION_ERRORS = {
  flow: {
    code: 'flow-condition',
    format: '出口条件必须使用工作流 JSON 语言',
    result: '出口条件必须返回布尔值',
  },
  complex: {
    code: 'complex-condition',
    format: '复杂网关必须配置使用工作流 JSON 语言的激活条件',
    result: '复杂网关条件必须返回布尔值',
  },
} as const;

export const BPMN_TYPE = Object.freeze({
  Activity: 'bpmn:Activity',
  Association: 'bpmn:Association',
  BoundaryEvent: 'bpmn:BoundaryEvent',
  BusinessRuleTask: 'bpmn:BusinessRuleTask',
  CallActivity: 'bpmn:CallActivity',
  CancelEventDefinition: 'bpmn:CancelEventDefinition',
  Collaboration: 'bpmn:Collaboration',
  CompensateEventDefinition: 'bpmn:CompensateEventDefinition',
  ComplexGateway: 'bpmn:ComplexGateway',
  ConditionalEventDefinition: 'bpmn:ConditionalEventDefinition',
  CorrelationKey: 'bpmn:CorrelationKey',
  CorrelationProperty: 'bpmn:CorrelationProperty',
  CorrelationSubscription: 'bpmn:CorrelationSubscription',
  Definitions: 'bpmn:Definitions',
  EndEvent: 'bpmn:EndEvent',
  ErrorEventDefinition: 'bpmn:ErrorEventDefinition',
  EscalationEventDefinition: 'bpmn:EscalationEventDefinition',
  EventBasedGateway: 'bpmn:EventBasedGateway',
  ExtensionElements: 'bpmn:ExtensionElements',
  FlowElementsContainer: 'bpmn:FlowElementsContainer',
  FlowNode: 'bpmn:FlowNode',
  FormalExpression: 'bpmn:FormalExpression',
  IntermediateCatchEvent: 'bpmn:IntermediateCatchEvent',
  IntermediateThrowEvent: 'bpmn:IntermediateThrowEvent',
  Lane: 'bpmn:Lane',
  MessageEventDefinition: 'bpmn:MessageEventDefinition',
  MessageFlow: 'bpmn:MessageFlow',
  ParallelGateway: 'bpmn:ParallelGateway',
  Participant: 'bpmn:Participant',
  Process: 'bpmn:Process',
  ReceiveTask: 'bpmn:ReceiveTask',
  ScriptTask: 'bpmn:ScriptTask',
  SendTask: 'bpmn:SendTask',
  SequenceFlow: 'bpmn:SequenceFlow',
  ServiceTask: 'bpmn:ServiceTask',
  SignalEventDefinition: 'bpmn:SignalEventDefinition',
  StartEvent: 'bpmn:StartEvent',
  SubProcess: 'bpmn:SubProcess',
  TerminateEventDefinition: 'bpmn:TerminateEventDefinition',
  TimerEventDefinition: 'bpmn:TimerEventDefinition',
  Transaction: 'bpmn:Transaction',
  UserTask: 'bpmn:UserTask',
} as const);

export const BPMN_EXTENSION = {
  Contract: 'kt:Contract',
  Step: 'kt:Step',
} as const;

export const BPMN_DI = Object.freeze({
  BPMNDiagram: 'bpmndi:BPMNDiagram',
  BPMNPlane: 'bpmndi:BPMNPlane',
  BPMNShape: 'bpmndi:BPMNShape',
} satisfies Record<string, string>);

export const BPMN_COORDINATE = Object.freeze({
  Bounds: 'dc:Bounds',
} satisfies Record<string, string>);

export const BPMN_KIND_GROUPS = {
  managedTasks: new Set<string>([
    BPMN_TYPE.BusinessRuleTask,
    BPMN_TYPE.ScriptTask,
    BPMN_TYPE.SendTask,
    BPMN_TYPE.ServiceTask,
    BPMN_TYPE.UserTask,
  ]) as ReadonlySet<string>,
  correlationOwners: new Set<string>([
    BPMN_TYPE.CorrelationKey,
    BPMN_TYPE.CorrelationProperty,
    BPMN_TYPE.CorrelationSubscription,
    BPMN_TYPE.Process,
  ]) as ReadonlySet<string>,
  correlationKeys: new Set<string>([
    BPMN_TYPE.CorrelationKey,
    BPMN_TYPE.CorrelationProperty,
  ]) as ReadonlySet<string>,
  eventGatewayTriggers: new Set<string>([
    BPMN_TYPE.ConditionalEventDefinition,
    BPMN_TYPE.MessageEventDefinition,
    BPMN_TYPE.SignalEventDefinition,
    BPMN_TYPE.TimerEventDefinition,
  ]) as ReadonlySet<string>,
  interruptingEvents: new Set<string>([
    BPMN_TYPE.CancelEventDefinition,
    BPMN_TYPE.ErrorEventDefinition,
  ]) as ReadonlySet<string>,
  implementedTasks: new Set<string>([
    BPMN_TYPE.BusinessRuleTask,
    BPMN_TYPE.SendTask,
    BPMN_TYPE.ServiceTask,
  ]) as ReadonlySet<string>,
  scopedEvents: new Set<string>([
    BPMN_TYPE.CancelEventDefinition,
    BPMN_TYPE.CompensateEventDefinition,
    BPMN_TYPE.ErrorEventDefinition,
  ]) as ReadonlySet<string>,
  catchEvents: new Set<string>([
    BPMN_TYPE.BoundaryEvent,
    BPMN_TYPE.IntermediateCatchEvent,
    BPMN_TYPE.StartEvent,
  ]) as ReadonlySet<string>,
  throwEvents: new Set<string>([
    BPMN_TYPE.EndEvent,
    BPMN_TYPE.IntermediateThrowEvent,
  ]) as ReadonlySet<string>,
  serviceTasks: new Set<string>([
    BPMN_TYPE.BusinessRuleTask,
    BPMN_TYPE.ScriptTask,
    BPMN_TYPE.SendTask,
    BPMN_TYPE.ServiceTask,
  ]) as ReadonlySet<string>,
  repeatingEvents: new Set<string>([
    BPMN_TYPE.EscalationEventDefinition,
    BPMN_TYPE.MessageEventDefinition,
    BPMN_TYPE.SignalEventDefinition,
  ]) as ReadonlySet<string>,
} as const;

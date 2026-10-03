const { createHash } = require('node:crypto');
const {
  MEDIA_WORKFLOW_INPUT_SCHEMA,
} = require('../../../src/modules/admin/media-governance/application/media-governance.workflow');
const {
  KT_BPMN_STEP,
  KT_BPMN_EXPRESSION,
} = require('../../../src/modules/workflow-engine/constants/bpmn');
const {
  parseWorkflowScriptUpload,
} = require('../../../src/modules/workflow-engine/domain/workflow-script-upload.policy');
const ref = (id) => ({ $ref: id });
const extension = (type, value) => ({
  $type: 'bpmn:ExtensionElements',
  values: [{ $type: type, body: JSON.stringify(value) }],
});
const formal = (value) => ({
  $type: 'bpmn:FormalExpression',
  language: KT_BPMN_EXPRESSION,
  body: JSON.stringify(value),
});

/**
 * 构造不含生产身份和真实脚本的同构媒体图，保留权威字段、顺序循环及固定版本语义。
 * @returns 脱敏的原媒体图和仅用于发布校验的无副作用脚本资产。
 */
function mediaFixture() {
  const keys = [
    'source.inspect',
    'source.probe-runtime',
    'source.download',
    'governance.execute',
    'acceptance.verify',
  ];
  const ids = ['Inspect', 'Probe', 'Download', 'Govern', 'Accept'];
  const scripts = keys.map((stepKey) => {
    const metadata = {
      protocol: 'kt.workflow.script.v1',
      key: `media.governance.${stepKey}`,
      name: '隔离验收脚本',
      description: '',
      processKey: 'media.governance',
      stepKey,
      maxTimeoutMs: 86400000,
      idempotent: false,
      paramsSchema: { fields: [] },
      resultSchema: { fields: [] },
      defaults: {},
    };
    const source = `/* @kt-workflow-script\n${JSON.stringify(metadata)}\n@end-kt-workflow-script */\nthrow new Error('隔离图只验证规则和人工办理，不执行媒体脚本');\n`;
    return {
      key: metadata.key,
      version: 1,
      target: 'local',
      declaration: parseWorkflowScriptUpload('fixture.mjs', source),
      source,
      sha256: createHash('sha256').update(source).digest('hex'),
    };
  });
  const business = ids.map((id, index) => {
    let revision = { type: 'node', nodeId: ids[index - 1], field: 'revision' };
    if (index === 0)
      revision = {
        type: 'first',
        sources: [
          { type: 'node', nodeId: id, field: 'revision' },
          { type: 'node', nodeId: 'SourceReview', field: 'revision' },
          { type: 'input', field: 'revision' },
        ],
      };
    if (index === 1)
      revision = {
        type: 'first',
        sources: [{ type: 'node', nodeId: id, field: 'revision' }, revision],
      };
    const input = { revision };
    if (index < 2) input.sourceIndex = { type: 'iteration' };
    const node = {
      $type: 'bpmn:ServiceTask',
      id,
      name: id,
      implementation: KT_BPMN_STEP,
      extensionElements: extension('kt:Step', {
        kind: 'business',
        stepKey: keys[index],
        input,
        scripts: [
          {
            key: scripts[index].key,
            version: 1,
            sha256: scripts[index].sha256,
            timeoutMs: 86400000,
            maxAttempts: 1,
            retryBackoffMs: 1000,
            params: {},
          },
        ],
      }),
    };
    if (index < 2)
      node.loopCharacteristics = {
        $type: 'bpmn:MultiInstanceLoopCharacteristics',
        isSequential: true,
        loopCardinality: formal({
          op: 'coalesce',
          values: [
            { path: 'outputs.SourceReview.sourceCount' },
            { path: 'input.sourceCount' },
          ],
        }),
      };
    return node;
  });
  const flow = (id, source, target) => ({
    $type: 'bpmn:SequenceFlow',
    id,
    sourceRef: ref(source),
    targetRef: ref(target),
  });
  const branch = {
    ...flow('Missing', 'Sources', 'SourceReview'),
    conditionExpression: formal({
      op: 'eq',
      left: { path: 'input.sourceCount' },
      right: { value: 0 },
    }),
  };
  const flowElements = [
    { $type: 'bpmn:StartEvent', id: 'Start' },
    { $type: 'bpmn:ExclusiveGateway', id: 'Sources', default: ref('Existing') },
    {
      $type: 'bpmn:UserTask',
      id: 'SourceReview',
      name: '补充并确认来源',
      extensionElements: extension('kt:Step', {
        kind: 'human',
        businessKey: 'source.review',
        formRef: null,
        writableFields: [],
        input: {},
      }),
    },
    ...business,
    { $type: 'bpmn:EndEvent', id: 'End' },
    flow('Entry', 'Start', 'Sources'),
    branch,
    flow('Existing', 'Sources', 'Inspect'),
    flow('Reviewed', 'SourceReview', 'Inspect'),
    ...ids.map((id, index) =>
      flow(`Next${index}`, id, [...ids, 'End'][index + 1]),
    ),
  ];
  const outputSchema = {
    fields: [
      { key: 'taskId', label: '治理任务', type: 'string', required: true },
      { key: 'workId', label: '所属作品', type: 'string', required: true },
      {
        key: 'mediaRunId',
        label: '业务步骤运行',
        type: 'string',
        required: true,
      },
      {
        key: 'evidenceSha256',
        label: '步骤证据摘要',
        type: 'string',
        required: true,
      },
    ],
  };
  const definition = {
    format: 'bpmn20',
    processRef: { key: 'media.governance', version: 1 },
    model: {
      $type: 'bpmn:Definitions',
      id: 'FixtureDefinitions',
      targetNamespace: 'urn:kt:test:shared-design',
      rootElements: [
        {
          $type: 'bpmn:Process',
          id: 'MediaProcess',
          isExecutable: true,
          flowElements,
          extensionElements: extension('kt:Contract', {
            processRef: { key: 'media.governance', version: 1 },
            inputSchema: MEDIA_WORKFLOW_INPUT_SCHEMA,
            outputSchema,
            output: {
              taskId: { type: 'input', field: 'taskId' },
              workId: { type: 'input', field: 'workId' },
              mediaRunId: {
                type: 'node',
                nodeId: 'Accept',
                field: 'mediaRunId',
              },
              evidenceSha256: {
                type: 'node',
                nodeId: 'Accept',
                field: 'evidenceSha256',
              },
            },
            formRef: null,
            formMapping: {},
            timeoutMs: 604800000,
          }),
        },
      ],
      diagrams: [
        {
          $type: 'bpmndi:BPMNDiagram',
          id: 'Diagram',
          plane: {
            $type: 'bpmndi:BPMNPlane',
            id: 'Plane',
            bpmnElement: ref('MediaProcess'),
            planeElement: [
              {
                $type: 'bpmndi:BPMNShape',
                id: 'Sources_di',
                bpmnElement: ref('Sources'),
                bounds: {
                  $type: 'dc:Bounds',
                  x: 385,
                  y: 120,
                  width: 50,
                  height: 50,
                },
              },
              {
                $type: 'bpmndi:BPMNEdge',
                id: 'Entry_di',
                bpmnElement: ref('Entry'),
                waypoint: [
                  { $type: 'dc:Point', x: 410, y: 80 },
                  { $type: 'dc:Point', x: 410, y: 120 },
                ],
              },
            ],
          },
        },
      ],
    },
  };
  return { definition, scripts };
}

module.exports = { mediaFixture };

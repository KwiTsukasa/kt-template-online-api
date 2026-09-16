import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const namespace = 'https://kwitsukasa.top/schema/workflow/bpmn/1';

/**
 * 用已读取的业务契约和精确脚本版本生成媒体完整草稿，缺少来源才进入人工确认。
 * @param capability - 媒体业务接口及本次选定的五项固定脚本，不含凭据和运行参数。
 * @returns 可提交给草稿接口的结构化模型；此函数不发布、不绑定业务，也不执行媒体动作。
 * @throws 业务接口、脚本版本或步骤不完整时拒绝生成半条可发布流程。
 */
export function prepareMediaWorkflow(capability) {
  const process = capability.process;
  if (process?.key !== 'media.governance' || process.version !== 1 || !process.inputSchema || !process.outputSchema)
    throw new Error('需要 media.governance@1 的实际业务契约');
  if (!process.humanSteps?.some((step) => step.key === 'source.review')) throw new Error('媒体业务缺少来源确认能力');
  const input = (field) => ({ type: 'input', field });
  const output = (nodeId, field) => ({ type: 'node', nodeId, field });
  const first = (...sources) => ({ type: 'first', sources });
  const count = JSON.stringify({ op: 'coalesce', values: [{ path: 'outputs.SourceReview.sourceCount' }, { path: 'input.sourceCount' }] });
  const extension = (type, body) => ({ $type: 'bpmn:ExtensionElements', values: [{ $type: type, body: JSON.stringify(body) }] });
  const activities = [
    ['Inspect', 'source.inspect', '检查来源清单', { revision: first(output('Inspect', 'revision'), output('SourceReview', 'revision'), input('revision')), sourceIndex: { type: 'iteration' } }],
    ['Probe', 'source.probe-runtime', '检查来源可用性', { revision: first(output('Probe', 'revision'), output('Inspect', 'revision')), sourceIndex: { type: 'iteration' } }],
    ['Download', 'source.download', '下载媒体载荷', { revision: output('Probe', 'revision'), autoSelect: { type: 'literal', value: true }, subtitleLanguage: { type: 'literal', value: 'zh-CN' } }],
    ['Govern', 'governance.execute', '治理媒体文件', { revision: output('Download', 'revision') }],
    ['Accept', 'acceptance.verify', '机械验收', { revision: output('Govern', 'revision') }],
  ].map(([id, stepKey, name, bindings]) => {
    if (!process.steps?.some((step) => step.key === stepKey)) throw new Error(`媒体业务缺少步骤 ${stepKey}`);
    const candidates = capability.scripts.filter((script) => script.processKey === process.key && script.stepKey === stepKey);
    if (candidates.length !== 1) throw new Error(`${stepKey} 必须提供唯一的固定脚本版本`);
    const script = candidates[0];
    if (!/^[a-f0-9]{64}$/.test(script.sha256) || !Number.isSafeInteger(script.version) || script.version < 1 || script.target !== 'nas' || !Number.isSafeInteger(script.maxTimeoutMs) || script.maxTimeoutMs < 1000)
      throw new Error(`${stepKey} 脚本身份或执行目标无效`);
    const element = { $type: 'bpmn:ServiceTask', id, name, implementation: `${namespace}/step`, extensionElements: extension('kt:Step', { kind: 'business', stepKey, input: bindings, scripts: [{ key: script.key, version: script.version, sha256: script.sha256, timeoutMs: script.maxTimeoutMs, maxAttempts: 1, retryBackoffMs: 1000, params: {} }] }) };
    if (id === 'Inspect' || id === 'Probe') element.loopCharacteristics = { $type: 'bpmn:MultiInstanceLoopCharacteristics', isSequential: true, loopCardinality: { $type: 'bpmn:FormalExpression', language: `${namespace}/expression`, body: count } };
    return element;
  });
  const connections = [
    ['Start', 'Sources'], ['Sources', 'SourceReview'], ['Sources', 'Inspect'], ['SourceReview', 'Inspect'],
    ['Inspect', 'Probe'], ['Probe', 'Download'], ['Download', 'Govern'], ['Govern', 'Accept'], ['Accept', 'End'],
  ];
  const flows = connections.map(([source, target]) => ({ $type: 'bpmn:SequenceFlow', id: `${source}_${target}`, sourceRef: { $ref: source }, targetRef: { $ref: target } }));
  flows[1].conditionExpression = { $type: 'bpmn:FormalExpression', language: `${namespace}/expression`, body: JSON.stringify({ op: 'eq', left: { path: 'input.sourceCount' }, right: { value: 0 } }) };
  const contract = { processRef: { key: process.key, version: process.version }, inputSchema: process.inputSchema, outputSchema: process.outputSchema, output: { taskId: input('taskId'), workId: input('workId'), mediaRunId: output('Accept', 'mediaRunId'), evidenceSha256: output('Accept', 'evidenceSha256') }, formRef: null, formMapping: {}, timeoutMs: 7 * 86400000 };
  const locations = [
    ['Start', 390, 40, 40, 40], ['Sources', 385, 120, 50, 50], ['SourceReview', 70, 180, 180, 76],
    ['Inspect', 320, 280, 180, 76], ['Probe', 320, 400, 180, 76], ['Download', 320, 520, 180, 76],
    ['Govern', 320, 640, 180, 76], ['Accept', 320, 760, 180, 76], ['End', 390, 885, 40, 40],
  ];
  const shapes = locations.map(([id, x, y, width, height]) => ({ $type: 'bpmndi:BPMNShape', id: `${id}_di`, bpmnElement: { $ref: id }, bounds: { $type: 'dc:Bounds', x, y, width, height } }));
  const edges = connections.map(([source, target]) => {
    const from = locations.find(([id]) => id === source);
    const to = locations.find(([id]) => id === target);
    let waypoint = [{ $type: 'dc:Point', x: from[1] + from[3] / 2, y: from[2] + from[4] }, { $type: 'dc:Point', x: to[1] + to[3] / 2, y: to[2] }];
    if (target === 'SourceReview') waypoint = [{ $type: 'dc:Point', x: from[1], y: from[2] + from[4] / 2 }, { $type: 'dc:Point', x: 160, y: 145 }, { $type: 'dc:Point', x: 160, y: to[2] }];
    if (source === 'SourceReview') waypoint = [{ $type: 'dc:Point', x: 250, y: 218 }, { $type: 'dc:Point', x: 285, y: 218 }, { $type: 'dc:Point', x: 285, y: 318 }, { $type: 'dc:Point', x: 320, y: 318 }];
    return { $type: 'bpmndi:BPMNEdge', id: `${source}_${target}_di`, bpmnElement: { $ref: `${source}_${target}` }, waypoint };
  });
  return { name: '媒体治理', description: '', definition: { format: 'bpmn20', model: { $type: 'bpmn:Definitions', id: 'MediaDefinitions', targetNamespace: 'urn:kt:media:governance', rootElements: [{ $type: 'bpmn:Process', id: 'MediaProcess', name: '媒体治理', isExecutable: true, extensionElements: extension('kt:Contract', contract), flowElements: [
    { $type: 'bpmn:StartEvent', id: 'Start', name: '创建任务' },
    { $type: 'bpmn:ExclusiveGateway', id: 'Sources', name: '检查来源资料', default: { $ref: 'Sources_Inspect' } },
    { $type: 'bpmn:UserTask', id: 'SourceReview', name: '补充并确认来源', extensionElements: extension('kt:Step', { kind: 'human', businessKey: 'source.review', formRef: null, writableFields: [], input: {} }) },
    ...activities, { $type: 'bpmn:EndEvent', id: 'End', name: '完成治理' }, ...flows,
  ] }], diagrams: [{ $type: 'bpmndi:BPMNDiagram', id: 'MediaDiagram', plane: { $type: 'bpmndi:BPMNPlane', id: 'MediaPlane', bpmnElement: { $ref: 'MediaProcess' }, planeElement: [...shapes, ...edges] } }] } } };
}

/**
 * 从脱敏能力清单生成可核对草稿文件，已有文件不覆盖且不自动调用发布接口。
 * @param args - 能力清单与输出草稿的绝对文件路径。
 * @throws 参数不完整、草稿已存在或业务合同不满足生成条件时拒绝写入。
 */
function main(args) {
  if (args.length !== 2 || args.some((value) => !path.isAbsolute(value))) throw new Error('需要能力清单与草稿输出的绝对路径');
  const draft = prepareMediaWorkflow(JSON.parse(readFileSync(args[0], 'utf8')));
  writeFileSync(args[1], JSON.stringify(draft, null, 2) + '\n', { flag: 'wx' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));

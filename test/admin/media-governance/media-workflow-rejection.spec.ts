import { createHash } from 'node:crypto';
import { AutomationValidationError } from '../../../src/common/automation/validation';
import { MEDIA_WORKFLOW_ERROR } from '../../../src/modules/admin/media-governance/constants/workflow';
import { MEDIA_FILE_SELECTION } from '../../../src/modules/admin/media-governance/constants/file-selection';
import type { WorkflowStepInvocation } from '../../../src/modules/workflow-engine/contract/workflow-process.interface';
import { createMediaWorkflowFixture } from './media-workflow.fixture';

const fixture = async () => {
  const service = createMediaWorkflowFixture();
  const task = await service.create({ mediaType: 'tv', seasonNumbers: ['S01'], titleHint: '真实来源失败回归' });
  const source = await service.addMagnetSource(task.id, {
    contentKind: 'embedded_subtitle_media', expectedRevision: task.revision,
    magnetUri: `magnet:?xt=urn:btih:${'a'.repeat(40)}`,
    releaseGroup: 'fixture', seasonNumbers: ['S01'], sourceRole: 'primary_media',
  });
  task.workId = 'work-fixture';
  source.manifestState = 'inspected';
  source.sourceHealth = 'unavailable';
  jest.spyOn(service, 'workflowTask').mockResolvedValue(task);
  const store = {
    readRunEnvelope: jest.fn(),
    readWorkflowEvidence: jest.fn(),
  };
  Object.assign(Reflect.get(service, 'stateStore'), store);
  const invocation: WorkflowStepInvocation = {
    business: {
      scopeId: task.workId, subjectId: task.id, revision: task.revision,
    },
    actorId: '1', stepKey: 'source.download', executionKey: 'media-probe-fixture',
    input: { revision: task.revision, autoSelect: true },
    receipt: null, stopRequested: false,
    signal: AbortSignal.timeout(10_000),
  };
  const mediaRunId = `media-run-${createHash('sha256').update(invocation.executionKey).digest('hex').slice(0, 48)}`;
  const prepared = { mediaRunId, taskId: task.id, sealedInputSha256: 'a'.repeat(64) };
  const evidenceSha256 = 'b'.repeat(64);
  const acceptance = {
    invocation, prepared,
    results: [{ status: 'succeeded' as const, exitCode: 0, executionId: 'script-fixture',
      script: { key: 'probe', version: 1, sha256: 'c'.repeat(64) },
      output: { ...prepared, evidenceSha256 } }],
  };
  return { service, task, source, store, invocation, prepared, acceptance, evidenceSha256 };
};

describe('媒体工作流的领域失败边界', () => {
  it('大清单的一一映射检查只线性读取选择项，不能退回逐项全表搜索', async () => {
    const item = await fixture();
    const count = 2000;
    let reads = 0;
    item.task.governanceProfile = 'embedded';
    item.source.selectedFileCount = count;
    item.source.selectedFileIndices = new Proxy(Array.from({ length: count }, (_, index) => index), {
      get: (target, key, receiver) => {
        if (typeof key === 'string' && /^\d+$/.test(key)) reads += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    item.source.selectedFileMappings = Array.from({ length: count }, (_, index) => ({
      index, unitId: item.task.units[0].id, episodeNumber: index + 1,
      fileRole: 'video', language: null,
    }));
    Reflect.get(item.service, 'assertDownloadFileMappings').call(item.service, item.task);
    expect(reads).toBeLessThanOrEqual(count * 4);
  });

  it('重复索引即使数量声明相等也不能冒充一一映射', async () => {
    const item = await fixture();
    item.task.governanceProfile = 'embedded';
    item.source.selectedFileCount = 2;
    item.source.selectedFileIndices = [0, 0];
    item.source.selectedFileMappings = [1, 2].map((episodeNumber) => ({
      index: 0, unitId: item.task.units[0].id, episodeNumber, fileRole: 'video', language: null,
    }));
    expect(() => Reflect.get(item.service, 'assertDownloadFileMappings').call(item.service, item.task))
      .toThrow(MEDIA_FILE_SELECTION.invalidMapping);
  });

  it('字幕合同通过索引匹配固定来源及路径，错误路径是领域拒绝', async () => {
    const item = await fixture();
    const unit = item.task.units[0];
    unit.expectedEpisodeNumbers = [1];
    item.task.governanceProfile = 'sidecar-linked';
    item.source.selectedFileCount = 1;
    item.source.selectedFileIndices = [0];
    item.source.selectedFileMappings = [{ index: 0, unitId: unit.id, episodeNumber: 1, fileRole: 'video', language: null }];
    const subtitle = { ...item.source, id: `${item.source.id}-subtitle`, sourceRole: 'supplemental_subtitle' as const,
      releaseGroup: 'fixture', selectedFileIndices: [1],
      manifest: [{ index: 1, relativePath: 'Show.S01E01.zh-CN.ass', sizeBytes: 1024, executable: false }],
      selectedFileMappings: [{ index: 1, unitId: unit.id, episodeNumber: 1, fileRole: 'subtitle' as const, language: 'zh-CN' as const }],
    };
    item.task.sources.push(subtitle);
    unit.subtitleContract = {
      expectedEpisodeNumbers: [1], releaseGroup: 'fixture', sourceId: subtitle.id, sourceIds: [subtitle.id],
      mappings: [{ episodeNumber: 1, relativePath: subtitle.manifest[0].relativePath }],
    };
    const check = () => Reflect.get(item.service, 'assertDownloadFileMappings').call(item.service, item.task);
    expect(check).not.toThrow();
    unit.subtitleContract.mappings[0].relativePath = 'wrong.ass';
    expect(check).toThrow(AutomationValidationError);
    expect(check).toThrow(MEDIA_FILE_SELECTION.subtitleMappingMismatch);
  });

  it.each(
    (['download', 'governance', 'acceptance', 'closed'] as const).flatMap((stage) =>
      ['source.inspect', 'source.probe-runtime'].map((stepKey) => ({ stage, stepKey }))),
  )('拒绝在 $stage 阶段准备 $stepKey，不能回退阶段或触及已有载荷', async ({ stage, stepKey }) => {
    const item = await fixture();
    item.task.stage = stage;
    item.task.progress.completedBytes = 1024;
    item.invocation.stepKey = stepKey;
    const reserve = jest.fn();
    Reflect.set(item.service, 'reserveExecution', reserve);
    const before = JSON.stringify(item.task);
    await expect(item.service.prepareWorkflowStep(item.invocation)).rejects.toThrow(MEDIA_WORKFLOW_ERROR.sourceStageInvalid);
    expect(reserve).not.toHaveBeenCalled();
    expect(JSON.stringify(item.task)).toBe(before);
  });

  it.each([
    [{ sourceIndex: 2 }, MEDIA_WORKFLOW_ERROR.sourceIndexUnavailable],
    [{ sourceId: 'missing' }, MEDIA_WORKFLOW_ERROR.sourceUnavailable],
    [{ sourceIndex: 1, sourceId: 'missing' }, MEDIA_WORKFLOW_ERROR.sourceSelectorConflict],
  ])('来源选择参数无效时结束为可识别的领域拒绝 (%j)', async (input, message) => {
    const item = await fixture();
    item.invocation.stepKey = 'source.inspect';
    item.invocation.input = { revision: item.task.revision, ...input };
    const outcome = await item.service.prepareWorkflowStep(item.invocation).catch((error: unknown) => error);
    expect(outcome).toBeInstanceOf(AutomationValidationError);
    expect(outcome).toMatchObject({ message });
  });

  it('来源不可用时在自动映射前拒绝，重复调用不改写修订或文件选择', async () => {
    const item = await fixture();
    const before = JSON.stringify(item.task);
    const select = jest.spyOn(item.service, 'applyAutomaticSourceSelection');
    await expect(item.service.prepareWorkflowStep(item.invocation)).rejects.toThrow(MEDIA_WORKFLOW_ERROR.primaryNotReady);
    await expect(item.service.prepareWorkflowStep(item.invocation)).rejects.toBeInstanceOf(AutomationValidationError);
    expect(select).not.toHaveBeenCalled();
    expect(JSON.stringify(item.task)).toBe(before);
  });

  it('已漂移的固定输入修订进入领域拒绝，不能永久按旧修订重试', async () => {
    const item = await fixture();
    item.task.revision += 1;
    await expect(item.service.prepareWorkflowStep(item.invocation)).rejects.toThrow(MEDIA_WORKFLOW_ERROR.revisionChanged);
  });

  it.each(['unavailable', 'inconclusive', 'unchecked'] as const)(
    '探针脚本退出成功但来源为 %s 时，业务验收仍拒绝推进下载', async (health) => {
      const item = await fixture();
      item.source.sourceHealth = health;
      item.store.readRunEnvelope.mockResolvedValue({
        replayKey: item.invocation.executionKey, sealedInputSha256: item.prepared.sealedInputSha256,
        action: 'source.probe-runtime', sources: [{ sourceId: item.source.id }],
      });
      item.store.readWorkflowEvidence.mockResolvedValue({
        taskId: item.task.id, status: 'succeeded', evidenceSha256: item.evidenceSha256,
      });
      await expect(item.service.acceptWorkflowStep(item.acceptance)).rejects.toThrow(MEDIA_WORKFLOW_ERROR.probeRejected);
    },
  );

  it('探针可用且脚本、持久证据身份吻合时返回下一步骤修订', async () => {
    const item = await fixture();
    item.source.sourceHealth = 'viable';
    item.store.readRunEnvelope.mockResolvedValue({
      replayKey: item.invocation.executionKey, sealedInputSha256: item.prepared.sealedInputSha256,
      action: 'source.probe-runtime', sources: [{ sourceId: item.source.id }],
    });
    item.store.readWorkflowEvidence.mockResolvedValue({
      taskId: item.task.id, status: 'succeeded', evidenceSha256: item.evidenceSha256,
    });
    await expect(item.service.acceptWorkflowStep(item.acceptance)).resolves.toMatchObject({
      taskId: item.task.id, revision: item.task.revision, evidenceSha256: item.evidenceSha256,
    });
  });

  it('持久化故障保持技术异常，不能被来源校验伪装为已失败', async () => {
    const item = await fixture();
    const failure = new Error('database disconnected');
    item.store.readRunEnvelope.mockRejectedValue(failure);
    await expect(item.service.prepareWorkflowStep(item.invocation)).rejects.toBe(failure);
  });
});

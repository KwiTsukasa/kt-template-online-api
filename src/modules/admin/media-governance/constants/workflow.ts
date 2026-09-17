export const MEDIA_WORKFLOW_ERROR = Object.freeze({
  revisionChanged: '媒体任务在步骤准备前已变更，请核对后重新处理',
  primaryNotReady: '主媒体来源尚未通过运行时探针',
  sourcesNotReady: '仍有来源未完成清单检查或运行时探针',
  probeRejected: '来源运行时探针未通过，请更换或修复来源',
  sourceStageInvalid: '来源检查只能在接收资料阶段执行',
  sourceSelectorConflict: '来源序号和来源身份只能选择一种',
  sourceIndexUnavailable: '来源序号超出任务范围',
  sourceUnavailable: '媒体步骤没有可用来源',
  sourceAmbiguous: '来源步骤必须明确选择一个来源',
  manifestRequired: '必须先检查来源清单',
});

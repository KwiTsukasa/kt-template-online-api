import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const steps = [
  ['source.inspect', '检查来源清单'],
  ['source.probe-runtime', '检查来源可用性'],
  ['source.download', '下载媒体载荷'],
  ['governance.execute', '治理媒体文件'],
  ['acceptance.verify', '机械验收'],
  ['source.cleanup', '清理指定来源'],
  ['governance.rebase', '重整规范身份目录'],
];

/**
 * 为每项媒体能力生成固定发布与配置摘要的标准脚本，参数只扩展标准 params 和 data 区。
 * @param identity - 已验证发布、文件清单及配置的摘要与仓库模板源码。
 * @returns 可直接上传至工作流模块的脚本文件及声明。
 * @throws 摘要或模板占位符缺失时拒绝生成未绑定运行库的脚本。
 */
export function prepareMediaScripts(identity) {
  const replacements = {
    __KT_MEDIA_RELEASE_SHA256__: identity.releaseId,
    __KT_MEDIA_MANIFEST_SHA256__: identity.manifestSha256,
    __KT_MEDIA_CONFIG_SHA256__: identity.configSha256,
  };
  let template = identity.template;
  for (const [placeholder, value] of Object.entries(replacements)) {
    if (!/^[a-f0-9]{64}$/.test(value) || !template.includes(placeholder)) {
      throw new Error('媒体脚本的发布身份或模板不完整');
    }
    template = template.replaceAll(placeholder, value);
  }
  const paramsSchema = { fields: [
    { key: 'mediaRunId', label: '媒体步骤运行', type: 'string', required: true },
    { key: 'taskId', label: '治理任务', type: 'string', required: true },
    { key: 'sealedInputSha256', label: '密封输入摘要', type: 'string', required: true },
  ] };
  return steps.map(([stepKey, name]) => {
    const declaration = {
      protocol: 'kt.workflow.script.v1', key: `media.${stepKey}`, name,
      description: '', processKey: 'media.governance', stepKey,
      maxTimeoutMs: 4 * 60 * 60 * 1000, idempotent: false,
      paramsSchema,
      resultSchema: { fields: [...paramsSchema.fields, { key: 'evidenceSha256', label: '业务证据摘要', type: 'string', required: true }] },
      defaults: {},
    };
    if (stepKey === 'source.download') declaration.maxTimeoutMs = 24 * 60 * 60 * 1000;
    return {
      filename: `media-${stepKey}.mjs`, declaration,
      source: `/* @kt-workflow-script\n${JSON.stringify(declaration)}\n@end-kt-workflow-script */\n${template}`,
    };
  });
}

/**
 * 从安装后的固定发布和私有配置生成上传文件，保留旧配置快照供既有版本继续使用。
 * @param args - 发布目录、配置文件与脚本输出目录三个绝对路径。
 * @throws 输入不完整或同摘要文件内容不一致时拒绝覆盖。
 */
function main(args) {
  if (args.length !== 3 || args.some((value) => !path.isAbsolute(value))) throw new Error('需要发布目录、配置文件和输出目录的绝对路径');
  const [releaseRoot, configFile, outputRoot] = args;
  const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
  const config = readFileSync(configFile);
  const configSha256 = digest(config);
  const scripts = prepareMediaScripts({
    releaseId: path.basename(releaseRoot), configSha256,
    manifestSha256: digest(readFileSync(path.join(releaseRoot, 'release-files.sha256'))),
    template: readFileSync(new URL('./media-action.mjs', import.meta.url), 'utf8'),
  });
  const configRoot = path.join(path.dirname(configFile), 'workflow');
  mkdirSync(configRoot, { recursive: true, mode: 0o700 });
  mkdirSync(outputRoot, { recursive: true, mode: 0o700 });
  const files = [[path.join(configRoot, configSha256 + '.json'), config], ...scripts.map((script) => [path.join(outputRoot, script.filename), Buffer.from(script.source)])];
  for (const [file, bytes] of files) {
    try { writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST' || !readFileSync(file).equals(bytes)) throw error;
    }
  }
  process.stdout.write(JSON.stringify({ configSha256, scripts: scripts.map((script) => ({ filename: script.filename, sha256: digest(script.source) })) }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main(process.argv.slice(2));

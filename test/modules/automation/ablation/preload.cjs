const { appendFileSync } = require('node:fs');
const engineModule = require('bpmn-engine');
const NativeEngine = engineModule.Engine;
const removed = JSON.parse(process.env.KT_ABLATION_REMOVE ?? '[]');

// 仅由测试子进程预加载：生产引擎不接受消融开关，也不修改任何源文件。
engineModule.Engine = class extends NativeEngine {
  constructor(options) {
    if (!options.extensions?.kt) {
      super(options);
      return;
    }
    const elements = { ...options.elements };
    const applied = [];
    for (const key of removed) {
      if (!Object.hasOwn(elements, key))
        throw new Error(`消融目标未注册：${key}`);
      delete elements[key];
      applied.push(key);
    }
    if (process.env.KT_ABLATION_AUDIT) {
      appendFileSync(
        process.env.KT_ABLATION_AUDIT,
        JSON.stringify({ applied }) + '\n',
      );
    }
    super({ ...options, elements });
  }
};

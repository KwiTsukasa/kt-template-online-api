const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
require('ts-node/register/transpile-only');
require('tsconfig-paths/register');
const {
  hydrateWorkflowBpmn,
} = require('../../../src/modules/workflow-engine/domain/workflow-bpmn-model');

const definition = () => ({
  format: 'bpmn20',
  model: {
    $type: 'bpmn:Definitions',
    targetNamespace: 'urn:kt:codec',
    id: 'D',
    rootElements: [
      {
        $type: 'bpmn:Process',
        flowElements: [
          {
            $type: 'bpmn:SequenceFlow',
            id: 'F',
            targetRef: { $ref: 'E' },
            sourceRef: { $ref: 'S' },
          },
          { $type: 'bpmn:StartEvent', id: 'S' },
          { $type: 'bpmn:EndEvent', id: 'E' },
        ],
        isExecutable: true,
        id: 'P',
      },
    ],
  },
});

test('工作栈保留规范化字节与前向引用，反复恢复不改写输入', () => {
  const input = definition();
  const original = JSON.stringify(input);
  const first = hydrateWorkflowBpmn(input);
  const second = hydrateWorkflowBpmn(
    JSON.parse(JSON.stringify(first.definition)),
  );
  assert.equal(JSON.stringify(input), original);
  assert.equal(
    JSON.stringify(first.definition),
    JSON.stringify(second.definition),
  );
  assert.equal(first.elements.F.sourceRef, first.elements.S);
  assert.equal(first.elements.F.targetRef, first.elements.E);
  assert.deepEqual(Object.keys(first.elements), ['F', 'S', 'E', 'P', 'D']);
  const digest = createHash('sha256')
    .update(JSON.stringify(first.definition))
    .digest('hex');
  assert.equal(
    digest,
    '2ade58fd79a51b6c7d91d534e85b0dce044fbaa2096ea839a800c69e74bb4c21',
  );
});

test('使用标准类型已有索引仍拒绝属性别名、原型成员、虚拟属性和多余引用字段', () => {
  for (const name of ['bpmn:id', 'toString', 'valueOf', '$parent']) {
    const input = definition();
    input.model.rootElements[0].flowElements[1][name] = 'invalid';
    assert.throws(() => hydrateWorkflowBpmn(input), /标准属性|不允许/);
  }
  const extra = definition();
  extra.model.rootElements[0].flowElements[0].sourceRef.extra = 'invalid';
  assert.throws(() => hydrateWorkflowBpmn(extra), /唯一的 \$ref/);
  const duplicate = definition();
  duplicate.model.rootElements[0].flowElements[2].id = 'S';
  assert.throws(() => hydrateWorkflowBpmn(duplicate), /重复/);
});

test('恢复不再按每个输入属性搜索描述列表', () => {
  const Moddle = require('bpmn-moddle');
  const originalCreate = Moddle.prototype.create;
  const moddle = new Moddle();
  const prototype = Object.getPrototypeOf(moddle);
  const create = prototype.create;
  prototype.create = function (...args) {
    const element = create.apply(this, args);
    element.$descriptor.properties.find = () => {
      throw new Error('逐属性重复搜索描述符');
    };
    return element;
  };
  try {
    assert.equal(hydrateWorkflowBpmn(definition()).root.id, 'D');
  } finally {
    prototype.create = create;
    assert.equal(Moddle.prototype.create, originalCreate);
  }
});

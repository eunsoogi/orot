import type { EvidenceItem, TaskResponderInput } from '@orot/agent-runtime';
import type { JsonValue } from '@orot/model-runtime';
import { webReference } from '../../aiFeatures/integration/testSupport/publicWebEvidenceTestSupport';
import { conversationA2UICatalog } from '../conversationA2UI';
import { publishPublicWebConversationLayout } from '../conversationA2UIPublicWebLayout';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

const answer = '공개 예시';
const notice = '앱의 공개 출처 설명';
const evidence: EvidenceItem = {
  ...webReference,
  content: 'Synthetic public evidence',
};
const input: TaskResponderInput = {
  request: '합성 자료를 읽기 쉽게 정리해 주세요.',
  context: [],
  evidence: { items: [evidence], coverage: [], conflicts: [] },
};
const value: JsonValue = {
  answerKind: 'grounded',
  answer,
  a2uiFrames: [
    {
      version: '1.0',
      createSurface: {
        surfaceId: 'orot:response:draft',
        catalogId: conversationA2UICatalog,
        components: [{ id: 'root', component: 'Text', text: answer }],
      },
    },
  ],
};

test('only the exact validated source and value can receive the app disclosure layout', () => {
  const outcome = ragConversationTask.validateResult(value, input);
  if (outcome.status !== 'valid')
    throw new Error('Expected a current grounded value');
  const accepted = outcome.value;
  expect(
    publishPublicWebConversationLayout(accepted, [webReference], notice),
  ).toBeDefined();
  expect(
    publishPublicWebConversationLayout(accepted, [], notice),
  ).toBeUndefined();
  expect(
    publishPublicWebConversationLayout(
      accepted,
      [{ ...webReference, evidenceRevision: 'revoked' }],
      notice,
    ),
  ).toBeUndefined();
  expect(
    publishPublicWebConversationLayout({ ...accepted }, [webReference], notice),
  ).toBeUndefined();
});

const denied: readonly TaskResponderInput[] = [
  {
    ...input,
    resultPartition: { sourceKind: 'external_medical', index: 0, total: 1 },
  },
  { ...input, context: { intent: 'visit_questions' } },
  { ...input, context: { suppressA2UIPresentation: true } },
  {
    ...input,
    evidence: {
      ...input.evidence,
      items: [evidence, { ...evidence, sourceId: 'private-record' }],
    },
  },
];
test.each(denied)(
  'does not issue a public layout receipt for a scoped or mixed-evidence reply',
  options => {
    const outcome = ragConversationTask.validateResult(value, options);
    if (outcome.status === 'valid')
      expect(
        publishPublicWebConversationLayout(
          outcome.value,
          [webReference],
          notice,
        ),
      ).toBeUndefined();
  },
);

test('restored v60 does not advertise or issue the new public-source receipt', () => {
  const old = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '60',
  });
  expect(JSON.stringify(old?.createResultSchema?.(input, true))).not.toContain(
    'grounded only in supplied public-web',
  );
  const result = old?.validateResult(value, input);
  if (result?.status !== 'valid')
    throw new Error('Expected historic grounded prose');
  expect(
    publishPublicWebConversationLayout(result.value, [webReference], notice),
  ).toBeUndefined();
});

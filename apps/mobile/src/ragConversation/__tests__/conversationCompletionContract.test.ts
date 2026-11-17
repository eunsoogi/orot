import { ragConversationTask } from '../task';
import { restoreConversationTask } from '../conversationTaskVersions';
import {
  conversationResultSchema,
  literatureConversationResultSchema,
} from '../literatureSchema';
import type { TaskResponderInput } from '@orot/agent-runtime';
const input = {
  request: '안녕',
  evidence: { items: [], coverage: [], conflicts: [] },
} as unknown as TaskResponderInput;
test('new answer contract has no coverage completion classification', () => {
  expect(ragConversationTask.taskVersion).toBe('11');
  for (const schema of [
    conversationResultSchema,
    literatureConversationResultSchema,
  ])
    expect(schema.properties).not.toHaveProperty('completion');
  expect(ragConversationTask.systemPrompt).not.toContain('completion=partial');
  for (const completion of ['complete', 'partial']) {
    const result = ragConversationTask.validateResult(
      { answerKind: 'conversation', answer: '안녕하세요.', completion },
      input,
    );
    expect(result).toEqual({
      status: 'valid',
      value: { answerKind: 'conversation', answer: '안녕하세요.' },
    });
  }
});
test('legacy task identities preserve old exact prompt and result contract without classifying new output', () => {
  const legacy = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '10',
  });
  expect(legacy?.systemPrompt).toContain('with completion=partial');
  expect(legacy?.systemPrompt).toContain('Set completion to partial');
  expect(legacy?.resultSchema?.properties).toHaveProperty('completion');
  expect(
    legacy?.validateResult(
      {
        answerKind: 'conversation',
        answer: '안녕하세요.',
        completion: 'partial',
      },
      input,
    ),
  ).toEqual({
    status: 'valid',
    value: { answerKind: 'conversation', answer: '안녕하세요.' },
  });
  expect(
    restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: '9',
    }),
  ).toBeDefined();
  expect(
    restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion: 'unknown',
    }),
  ).toBeUndefined();
});

import historicalContracts from '../testSupport/conversationLegacyPayloadContracts.json';
import { stableJson } from '../../aiFeatures/integration/evidenceUtils';
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
  expect(ragConversationTask.taskVersion).toBe('15');
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

test('legacy response contracts keep full native receipts while new turns avoid duplicate bodies', () => {
  expect(ragConversationTask.nativeToolResultMode).toBe('evidence_references');
  for (const taskVersion of ['9', '10', '11'] as const) {
    const legacy = restoreConversationTask({
      taskType: ragConversationTask.taskType,
      taskVersion,
    });
    expect(legacy?.taskVersion).toBe(taskVersion);
    // Frozen from the shipped pre-change contracts at 66726774, not reconstructed from the live task.
    expect(stableJson(legacy)).toBe(historicalContracts[taskVersion]);
    expect(legacy?.nativeToolResultMode).toBeUndefined();
    expect(
      Object.prototype.hasOwnProperty.call(legacy, 'nativeToolResultMode'),
    ).toBe(false);
  }
  const previous = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '11',
  })!;
  expect(previous.createMessages(input)).toEqual(
    ragConversationTask.createMessages(input),
  );
  // Historical prompts retain their original period policy; only current work uses full history.
  expect(previous.systemPrompt).toContain('30 days, summary detail by default');
  expect(ragConversationTask.systemPrompt).toContain(
    'all available imported history, summary detail by default',
  );
  expect(ragConversationTask.systemPrompt).not.toContain(
    'at most 90 local calendar days',
  );
  expect(previous.resultSchema).toHaveProperty(
    'properties.answer.maxLength',
    4000,
  );
  expect(ragConversationTask.resultSchema).not.toHaveProperty(
    'properties.answer.maxLength',
  );
});

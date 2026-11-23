import type { TaskResponderInput } from '@orot/agent-runtime';
import { createConversationRetentionBridge } from '../../aiFeatures/integration/conversationRetentionBridge';
import { LocalEvidenceReferenceRegistry } from '../../aiFeatures/integration/evidenceRegistry';
import { conversationStatementMemory } from '../../memory/userStatementMemory';
import { conversationWorkflowContext } from '../conversationWorkflowContext';
import type { RagConversationRunOptions } from '../service';
import { restoreConversationTask } from '../conversationTaskVersions';
import { ragConversationTask } from '../task';

test.each(['composer', 'shortcut'] as const)(
  'the %s request keeps its typed safety context without manufacturing user-authored memory',
  async inputOrigin => {
    const question = '앞으로 짧은 답변을 선호합니다.';
    const request = {
      request: question,
      evidence: { items: [], coverage: [], conflicts: [] },
      context: conversationWorkflowContext({
        entryIntent: 'possibilities',
        authoredCurrentRequest: inputOrigin === 'composer',
        previousMessages: [],
      } as unknown as RagConversationRunOptions),
    } as unknown as TaskResponderInput;
    expect(request.context).toMatchObject({ intent: 'possibilities' });
    const schema = ragConversationTask.createResultSchema?.(request);
    expect(
      Boolean(
        (schema?.properties as Record<string, unknown>)
          ?.rememberCurrentStatement,
      ),
    ).toBe(inputOrigin === 'composer');

    const accept = jest.fn();
    const bridge = createConversationRetentionBridge({
      question,
      signal: new AbortController().signal,
      registry: new LocalEvidenceReferenceRegistry(),
      observer: { inputOrigin, onRetentionCandidate: accept },
      entryContext: { intent: 'possibilities', entryKey: 'restored' },
      providerId: 'fixture-provider',
      modelId: 'fixture-model',
    });
    bridge.onValidatedEvidence([]);
    // Even a forged model bit cannot make a generated shortcut statement eligible.
    const result = await bridge.finish({
      status: 'answer',
      answer: 'INFERRED_TEXT_NOT_A_MEMORY',
      citations: [],
      proactiveMemory: true,
    });
    expect(result.retained).toBe(true);
    const [retained] = accept.mock.calls[0];
    expect(retained.entryIntent).toBe('possibilities');
    expect(retained.proactiveMemory).toBe(
      inputOrigin === 'composer' ? true : undefined,
    );
    const memory = conversationStatementMemory({
      ...retained,
      id: 'fixture-turn',
      sessionId: 'fixture-session',
      status: 'complete',
      createdAt: '2026-11-01T00:00:00.000Z',
    });
    // A proposal never authorizes embedding, even for typed follow-up.
    expect(memory).toBeUndefined();
  },
);

test('only the current v18 contract proposes a bounded routine; older checkpoint policy is unchanged', () => {
  const restored = restoreConversationTask({
    taskType: ragConversationTask.taskType,
    taskVersion: '17',
  })!;
  const input = {
    request: 'I practice the guitar every Monday.',
    evidence: { items: [], coverage: [], conflicts: [] },
    context: { intent: 'possibilities', authoredCurrentRequest: true },
  } as unknown as TaskResponderInput;
  expect(restored.createResultSchema?.(input)?.properties).not.toHaveProperty(
    'rememberCurrentStatement',
  );
  expect(
    ragConversationTask.createResultSchema?.(input)?.properties,
  ).toHaveProperty('rememberCurrentStatement');
  const proposed = {
    answerKind: 'conversation',
    answer: 'Synthetic reply',
    rememberCurrentStatement: true,
  };
  expect(restored.validateResult(proposed, input)).toMatchObject({
    status: 'valid',
    value: { answer: 'Synthetic reply' },
  });
  expect(restored.validateResult(proposed, input)).not.toHaveProperty(
    'value.proactiveMemory',
  );
  expect(ragConversationTask.validateResult(proposed, input)).toHaveProperty(
    'value.proactiveMemory',
    true,
  );
});

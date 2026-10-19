import type {
  MultiAgentProgressEvent,
  MultiAgentResponderStreamEvent,
} from '@orot/agent-runtime';
import type { VisitQuestionResponderInput } from '../taskContract';
import { createVisitQuestionTaskResponder } from '../taskContract';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeStreamingProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

test('projects only visit questions supported by available evidence and safe to ask', () => {
  const input: VisitQuestionResponderInput = {
    request: '혈압 기록에 대해 확인할 질문을 작성해 주세요.',
    context: { effectiveAt: '2026-10-18T12:00:00.000Z' },
    evidence: {
      items: [
        {
          sourceKind: 'personal_record',
          sourceId: 'record',
          sourceRevision: 'record-revision',
          evidenceId: 'blood-pressure',
          evidenceRevision: 'evidence-revision',
          locator: null,
          effectiveTime: '2026-10-18T09:00:00.000Z',
          reviewState: 'reviewed',
          content: '혈압 120/80 mmHg',
        },
      ],
      coverage: [],
      conflicts: [],
    },
  };
  const responder = createVisitQuestionTaskResponder();
  const project = (questionText: string) =>
    responder.projectStreamedText(
      JSON.stringify({ value: { questions: [{ questionText }] } }),
      input,
    );

  expect(project('혈압이 120/80 mmHg로 기록된 이유를 확인해도 될까요?')).toBe(
    '혈압이 120/80 mmHg로 기록된 이유를 확인해도 될까요?',
  );
  expect(project('혈압이 130/80 mmHg로 기록된 이유를 확인해도 될까요?')).toBe(
    undefined,
  );
  expect(project('약을 중단하세요?')).toBeUndefined();
});

test('streams only the first question field and keeps evidence activity content-free', async () => {
  const prepared = preparedContext();
  const { provider } = makeStreamingProvider(
    successfulOutputs(prepared.initialEvidence, prepared.supplementalEvidence),
  );
  const { selection, option } = selectedOption(provider, 'on-device');
  const progress: MultiAgentProgressEvent[] = [];
  const stream: MultiAgentResponderStreamEvent[] = [];

  const result = await runVisitQuestionWorkflow({
    prepared,
    selection,
    providerOptions: [option],
    observer: {
      onProgress: event => progress.push(event),
      onTaskStreamEvent: event => stream.push(event),
    },
  });

  expect(result.status).toBe('ready');
  if (result.status !== 'ready') return;
  let preview = '';
  for (const event of stream) {
    if (event.type === 'started') preview = '';
    else if (event.type === 'text_delta') preview += event.text;
    else preview = event.text;
  }
  expect(preview).toBe(result.questions[0]?.questionText);
  expect(progress).toContainEqual({
    type: 'evidence_search',
    status: 'started',
    sourceKind: 'personal_record',
  });
  expect(JSON.stringify({ progress, stream })).not.toMatch(
    /private-source-|private-span-|citation|evidenceId|rationale|toolId/u,
  );
});

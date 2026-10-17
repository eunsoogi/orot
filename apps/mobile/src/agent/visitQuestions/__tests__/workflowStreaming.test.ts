import type {
  MultiAgentProgressEvent,
  MultiAgentResponderStreamEvent,
} from '@orot/agent-runtime';
import { runVisitQuestionWorkflow } from '../workflow';
import {
  makeStreamingProvider,
  preparedContext,
  selectedOption,
  successfulOutputs,
} from '../testing/workflowFixtures';

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

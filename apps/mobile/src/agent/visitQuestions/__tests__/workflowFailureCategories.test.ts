import { createVisitQuestionEvidenceAliases } from '../evidenceAliases';
import { preparedContext } from '../testing/workflowFixtures';
import { mapVisitQuestionWorkflowResult } from '../workflowResults';

test('preserves exhausted budget and provider classification for the conversation adapter', async () => {
  const prepared = preparedContext();
  const aliases = createVisitQuestionEvidenceAliases(prepared.evidence.batch);
  const budget = await mapVisitQuestionWorkflowResult({
    prepared,
    aliases,
    result: {
      status: 'budget_exceeded',
      reason: 'synthetic',
      checkpoint: {} as never,
    },
  });
  expect(budget.status).toBe('budget_exceeded');
  const provider = await mapVisitQuestionWorkflowResult({
    prepared,
    aliases,
    result: {
      status: 'unavailable',
      reason: 'PRIVATE_PROVIDER_TEXT',
      providerErrorCode: 'rate_limited',
      checkpoint: {} as never,
    },
  });
  expect(provider).toMatchObject({
    status: 'unavailable',
    providerErrorCode: 'rate_limited',
  });
  expect(JSON.stringify(provider)).not.toContain('PRIVATE_PROVIDER_TEXT');
});

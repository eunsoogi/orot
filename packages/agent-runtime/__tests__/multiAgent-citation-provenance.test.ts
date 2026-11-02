import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  reference,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

// Exercise the real adapter and decoder together: an ID resolves only to the current publication.
async function runWithCitation(citation: unknown) {
  const outputs = scriptedOutputs();
  outputs[2] = JSON.stringify({
    type: 'result',
    value: { summary: 'Synthetic citation.' },
    citations: [citation],
  });
  const { provider } = makeProvider(outputs);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [publication] }) },
    consent: { authorize: async () => 'authorized' },
  });
  return runMultiAgentWorkflow(workflowOptions(provider, tool));
}

test('binds an evidence ID to its provider and exact publication locator', async () => {
  const result = await runWithCitation('MED:12345');
  expect(result.status).toBe('result');
  if (result.status === 'result') expect(result.citations).toEqual([reference]);
});

test.each([
  ['another article ID', 'MED:54321'],
  ['another provider', { ...reference, sourceId: 'other-provider' }],
  [
    'another publication locator',
    { ...reference, locator: { ...reference.locator, recordId: '54321' } },
  ],
])('rejects %s instead of binding it to the supplied publication', async (_label, citation) => {
  expect((await runWithCitation(citation)).status).toBe('invalid_output');
});

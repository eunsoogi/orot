import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

test.each([false, true])(
  'bounded literature opt-in %s preserves honest five-result coverage',
  async (allow) => {
    const { provider } = makeProvider(scriptedOutputs());
    const tool = createEuropePmcEvidenceSearchTool({
      service: {
        search: async () => ({
          status: 'available',
          publications: Array.from({ length: 5 }, (_, index) => ({
            ...publication,
            recordId: index ? `test${index}` : publication.recordId,
            originalUrl: index
              ? `https://europepmc.org/article/${publication.source}/test${index}`
              : publication.originalUrl,
          })),
        }),
      },
      consent: { authorize: async () => 'authorized' },
    });
    const options = workflowOptions(provider, tool);
    const result = await runMultiAgentWorkflow({
      ...options,
      task: { ...options.task, allowBoundedExternalEvidence: allow },
    });
    expect(result.status).toBe(allow ? 'result' : 'needs_clarification');
    expect(result.coverage[0].truncated).toBe(true);
  },
);

test('bounded external policy still rejects missing abstracts', async () => {
  const { provider } = makeProvider(scriptedOutputs());
  const tool = createEuropePmcEvidenceSearchTool({
    service: {
      search: async () => ({
        status: 'available',
        publications: [{ ...publication, abstract: null }],
      }),
    },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(provider, tool);
  const result = await runMultiAgentWorkflow({
    ...options,
    task: { ...options.task, allowBoundedExternalEvidence: true },
  });
  expect(result.status).toBe('needs_clarification');
});

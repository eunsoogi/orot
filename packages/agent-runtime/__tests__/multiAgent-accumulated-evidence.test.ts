import { restoreOrderedEvidenceBatches } from '../src/multiAgent/evidenceRestoration';
import { createEuropePmcEvidenceSearchTool, runMultiAgentWorkflow } from '../src';
import {
  makeProvider,
  reference,
  publication,
  scriptedOutputs,
  workflowOptions,
} from './multiAgent-external-evidence-fixtures';

function fixture(unbounded = true, search = false) {
  const references = Array.from({ length: 25 }, (_, i) => ({
    ...reference,
    evidenceId: `synthetic-${i}`,
  }));
  const model = makeProvider([
    ...(search ? scriptedOutputs().slice(0, 2) : []),
    JSON.stringify({
      type: 'result',
      value: { summary: 'Synthetic cited answer.' },
      citations: search ? [...references, reference] : references,
    }),
  ]);
  const tool = createEuropePmcEvidenceSearchTool({
    service: { search: async () => ({ status: 'available', publications: [publication] }) },
    consent: { authorize: async () => 'authorized' },
  });
  const options = workflowOptions(model.provider, tool);
  return {
    model,
    options: {
      ...options,
      execution: {
        ...options.execution,
        budget: {
          ...options.execution.budget,
          ...(unbounded ? { maxAccumulatedEvidenceItems: null } : {}),
        },
      },
      initialEvidence: {
        items: references.map((ref) => ({ ...ref, content: 'Synthetic fact.' })),
        conflicts: [],
        coverage: [
          {
            sourceKind: 'external_medical' as const,
            searchedSourceIds: ['europe-pmc'],
            gaps: [],
            truncated: false,
            resultLimit: 25,
            returnedCount: 25,
          },
        ],
      },
    },
  };
}

test('a cited initial report is not truncated or rejected at the legacy item count', async () => {
  const f = fixture();
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('result');
  expect(f.model.generate).toHaveBeenCalledTimes(1);
  expect(result.checkpoint.evidenceReferences).toHaveLength(25);
  expect(f.options.consent.authorize).toHaveBeenCalledTimes(1);
});

test('legacy callers keep their existing count bound', async () => {
  const f = fixture(false);
  expect((await runMultiAgentWorkflow(f.options)).status).toBe('invalid_output');
  expect(f.model.generate).not.toHaveBeenCalled();
});

test.each(['stale', 'denied'])(
  'count opt-out preserves %s protection before model dispatch',
  async (kind) => {
    const f = fixture();
    if (kind === 'stale') f.options.revalidateEvidence = jest.fn(async () => false);
    else f.options.consent = { authorize: jest.fn(async () => 'renewal_required') };
    expect((await runMultiAgentWorkflow(f.options)).status).toBe(
      kind === 'stale' ? 'stale_evidence' : 'consent_required',
    );
    expect(f.model.generate).not.toHaveBeenCalled();
  },
);

test('research after a large selected report keeps a bounded search page and all prior references', async () => {
  const f = fixture(true, true);
  const result = await runMultiAgentWorkflow(f.options);
  expect(result.status).toBe('result');
  expect(result.checkpoint.evidenceReferences).toHaveLength(26);
  expect(result.checkpoint.toolCalls).toBe(1);
  expect(f.model.generate).toHaveBeenCalledTimes(3);
});

test.each([1, 6])(
  'restored search pages retain their page budget separately from %s accumulated items',
  async (count) => {
    const f = fixture();
    const page = {
      ...f.options.initialEvidence,
      items: Array.from({ length: count }, (_, index) => ({
        ...reference,
        evidenceId: `page-${index}`,
        content: 'Synthetic page.',
      })),
      coverage: [
        { ...f.options.initialEvidence.coverage[0]!, resultLimit: count, returnedCount: count },
      ],
    };
    const batches = [f.options.initialEvidence, page];
    const restored = await restoreOrderedEvidenceBatches(
      {
        ...f.options,
        restoreEvidenceBatches: async () => batches,
      },
      batches.flatMap((batch) => batch.items),
      new AbortController().signal,
    );
    if (count > f.options.execution.budget.maxEvidenceItems) expect(restored).toBeUndefined();
    else expect(restored?.items).toHaveLength(25 + count);
  },
);

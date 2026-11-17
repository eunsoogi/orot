import { conversationInitialEvidence } from '../../../ragConversation/conversationInitialEvidence';
import type { RagConversationRunOptions } from '../../../ragConversation/service';
import { createDailyReportIdentity } from '@orot/domain';
import { prepareDailyReportConversationEvidence } from '../dailyReportConversationEvidence';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { localData } from '../featureServiceFixtures';

/** Synthetic selected-report references exercise admission without reading user records. */
function fixture(count = 25) {
  const registry = new LocalEvidenceReferenceRegistry();
  let current = true;
  const sources = Array.from({ length: count }, (_, index) =>
    registry.add({
      reference: {
        sourceKind: 'personal_record',
        sourceId: `record-${index}`,
        evidenceId: `record-${index}`,
        sourceRevision: '1',
        evidenceRevision: '1',
        locator: {},
        effectiveTime: null,
        reviewState: 'unreviewed',
      },
      content: '',
      validate: async () => current,
      readSource: async () =>
        current
          ? ({
              status: 'available',
              document: {
                sourceKind: 'personal_record',
                records: [
                  {
                    kind: 'health_observation',
                    record: {
                      id: `record-${index}`,
                      concept: 'heart_rate',
                      value: {
                        kind: 'quantity',
                        amount: 72,
                        unit: 'count/min',
                      },
                    },
                  },
                ],
              },
            } as never)
          : { status: 'changed' },
    }),
  );
  const controller = new AbortController();
  return {
    change: () => {
      current = false;
    },
    controller,
    input: {
      report: {
        identity: createDailyReportIdentity('2035-01-01', 'UTC'),
        runId: 'synthetic',
        revision: 1,
      },
      resolve: async () =>
        current
          ? { status: 'current' as const, sources }
          : { status: 'stale' as const },
      registry,
      loadLocalData: async () => localData([]).data,
      signal: controller.signal,
    },
  };
}

test('selected reports retain every source beyond the former admission and storage ceilings', async () => {
  const f = fixture();
  const prepared = await prepareDailyReportConversationEvidence(f.input);
  expect(prepared?.items).toHaveLength(25);
  expect(new Set(prepared?.items.map(item => item.evidenceId)).size).toBe(25);
  expect(await prepared?.isCurrent()).toBe(true);
  // Exercise the shipping aggregation seam too, not only the preflight reader.
  const batch = await conversationInitialEvidence(
    {
      dailyReportEvidence: prepared!.items,
      loadCurrentEvidence: async () => ({
        batch: { items: [], coverage: [], conflicts: [] },
        chunks: [],
      }),
      rag: { search: jest.fn() },
      workflow: {
        execution: {
          budget: { maxEvidenceItems: 8, maxAccumulatedEvidenceItems: null },
        },
      },
    } as unknown as RagConversationRunOptions,
    'Synthetic selected report',
  );
  expect(batch.items).toEqual(prepared!.items);
  expect(batch.coverage[0]?.returnedCount).toBe(25);
  f.change();
  expect(await prepared?.isCurrent()).toBe(false);
});

test('cancellation still rejects a selected report without dropping its sources', async () => {
  const f = fixture();
  f.controller.abort();
  expect(await prepareDailyReportConversationEvidence(f.input)).toBeNull();
});

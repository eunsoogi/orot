import type { EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceSourceReadResult } from '../evidenceSourceDocument';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { captureConversationSources } from '../captureConversationSources';

/** Capability isolation is a registry contract, independent of SQL hydration tests. */
test('identical alias shapes in another registry cannot borrow authority, and each operation is fresh', async () => {
  const original: EvidenceReference = {
    sourceKind: 'generated_artifact',
    sourceId: 'turn',
    evidenceId: 'turn',
    sourceRevision: 'revision',
    evidenceRevision: 'revision',
    locator: { kind: 'generated_artifact', type: 'conversation_turn' },
    effectiveTime: null,
    reviewState: 'unreviewed',
  };
  const result: EvidenceSourceReadResult = {
    status: 'available',
    document: {
      sourceKind: 'generated_artifact',
      metadata: {
        id: 'turn',
        type: 'conversation_turn',
        revision: 'revision',
        originFeature: 'record_conversation',
        originSession: 'session',
        createdAt: '2026-10-01T00:00:00Z',
        eventTime: null,
        providerId: 'synthetic',
        modelId: 'synthetic',
        completion: 'complete',
        review: 'unreviewed',
      },
      conversation: { question: 'Synthetic', answer: 'Synthetic' },
      sources: [],
      sourceStatus: 'unknown',
    },
  };
  let current = true;
  const finish = jest.fn(async () => current);
  const prepare = jest.fn(async () => ({ results: [result], finish }));
  const first = new LocalEvidenceReferenceRegistry();
  const owner = { registry: first, prepare };
  const second = new LocalEvidenceReferenceRegistry();
  const read = jest.fn(async (): Promise<EvidenceSourceReadResult> => ({
    status: 'missing',
  }));
  const a = first.add({
    reference: original,
    content: '',
    readSource: read,
    validate: async () => false,
    capture: { owner, identity: { id: 'turn', revision: 'revision' } },
  });
  const b = second.add({
    reference: original,
    content: '',
    readSource: read,
    validate: async () => false,
    capture: { owner, identity: { id: 'turn', revision: 'revision' } },
  });
  expect(a).toEqual(b);
  const signal = new AbortController().signal;
  expect(
    (await captureConversationSources([a], first, signal)).sources,
  ).toHaveLength(1);
  await expect(
    captureConversationSources([b], second, signal),
  ).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(
    (await captureConversationSources([a], first, signal)).sources,
  ).toHaveLength(1);
  expect(prepare).toHaveBeenCalledTimes(2);
  current = false;
  await expect(
    captureConversationSources([a], first, signal),
  ).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(3);
  expect(finish).toHaveBeenCalledTimes(3);
  // A capability cannot create an edge to its own newly issued alias.
  const self = first.add({
    reference: original,
    content: '',
    readSource: read,
    validate: async () => false,
    capture: {
      owner,
      identity: {
        id: 'turn',
        revision: 'revision',
        bound: {
          parentId: 'outer',
          parentRevision: 'r',
          reference: {
            ...a,
            evidenceId: 'e2',
            sourceRevision: 'sr2',
            evidenceRevision: 'er2',
            locator: { kind: 'local-evidence', token: 'e2' },
          },
        },
      },
    },
  });
  await expect(
    captureConversationSources([self], first, signal),
  ).rejects.toThrow();
  expect(prepare).toHaveBeenCalledTimes(3);
});

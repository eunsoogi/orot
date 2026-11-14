import { referenceOnly } from '../../../diseaseHypotheses/resultValidation';
import type { EvidenceReference } from '@orot/agent-runtime';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import {
  coldConversationToolEvents,
  coldSnapshotResearchTarget,
} from '../coldConversationToolEvents';
import { conversationToolEventFixtures } from '../../../ragConversation/testSupport/conversationToolEventFixtures';
import type { StoredConversationToolTurn } from '../../../storage/conversationToolEventStorage';

const owner = {
  sessionId: 'session',
  sessionVersion: 0,
  requestId: 'request',
  operationRunId: 'synthetic-run',
};
function fixture() {
  const registry = new LocalEvidenceReferenceRegistry();
  const original: EvidenceReference = {
    sourceKind: 'reviewed_memory',
    sourceId: 'private-source',
    sourceRevision: '1',
    evidenceId: 'private-evidence',
    evidenceRevision: '2',
    locator: null,
    effectiveTime: null,
    reviewState: 'unknown',
  };
  const add = (reference = original) =>
    registry.add({
      reference,
      content: '',
      validate: async () => true,
      readSource: async () => ({ status: 'unavailable' }),
    });
  const alias = add();
  const event = { ...conversationToolEventFixtures[0]!, sources: [original] };
  const turns: StoredConversationToolTurn[] = [
    {
      messageId: 'request',
      createdAt: '2026-01-01',
      toolEvents: [event],
      lineages: [
        {
          runId: owner.operationRunId,
          callId: event.callId,
          sources: [{ reference: original, records: [] }],
        },
      ],
    },
  ];
  return { registry, original, alias, turns, add, event };
}

test('normalizes durable originals to exact cold aliases, not a colliding restored/global alias', () => {
  const f = fixture();
  const other = new LocalEvidenceReferenceRegistry();
  const colliding = other.add({
    reference: { ...f.original, sourceId: 'different-private-source' },
    content: '',
    validate: async () => true,
    readSource: async () => ({ status: 'unavailable' }),
  });
  expect(colliding.evidenceId).toBe(f.alias.evidenceId);
  const result = coldConversationToolEvents(
    f.turns,
    owner,
    f.registry.snapshot(),
  );
  expect(result[0]!.sources[0]).toMatchObject({
    sourceId: f.alias.sourceId,
    evidenceId: f.alias.evidenceId,
  });
  expect(
    coldConversationToolEvents(f.turns, owner, other.snapshot())[0]!.sources,
  ).toEqual([]);
  expect(f.turns[0]!.toolEvents[0]!.sources[0]).toBe(f.original);
});

test('missing, changed and ambiguous original bindings are not openable', () => {
  const f = fixture();
  const snapshot = f.registry.snapshot();
  const changed = {
    ...snapshot,
    entries: snapshot.entries.map(row => ({
      ...row,
      original: { ...row.original, evidenceRevision: 'changed' },
    })),
  };
  expect(
    coldConversationToolEvents(f.turns, owner, changed)[0]!.sources,
  ).toEqual([]);
  f.add();
  expect(
    coldConversationToolEvents(f.turns, owner, f.registry.snapshot())[0]!
      .sources,
  ).toEqual([]);
  expect(
    coldConversationToolEvents(
      f.turns,
      { ...owner, requestId: 'other' },
      snapshot,
    ),
  ).toEqual([]);
  expect(
    coldConversationToolEvents(
      f.turns,
      { ...owner, operationRunId: 'other' },
      snapshot,
    ),
  ).toEqual([]);
  expect(() =>
    coldConversationToolEvents(
      [{ ...f.turns[0]!, lineages: [] }],
      owner,
      snapshot,
    ),
  ).toThrow('lineage');
});

test('external links require the same ready research target, not merely current source membership', () => {
  const f = fixture();
  const research: EvidenceReference = {
    ...f.original,
    sourceKind: 'generated_artifact',
    sourceId: 'research-1',
    evidenceId: 'research-1',
    sourceRevision: 'r1',
    evidenceRevision: 'r1',
    locator: { kind: 'generated_artifact', type: 'research_publication' },
  };
  const alias = referenceOnly(f.add(research));
  const source = { ...f.original, sourceKind: 'external_medical' as const };
  const scope = {
    sessionId: owner.sessionId,
    operationRunId: owner.operationRunId,
    callId: f.event.callId,
  };
  f.registry.toolReferences.bindResearch(source, alias, scope, true);
  const snapshot = f.registry.snapshot();
  const scoped = f.registry.toolReferences.snapshotScope(
    owner,
    [f.event.callId],
    ref => f.registry.resolve(ref),
  );
  const target = coldSnapshotResearchTarget(scoped, snapshot, owner);
  const turn: StoredConversationToolTurn = {
    ...f.turns[0]!,
    toolEvents: [{ ...f.event, sources: [source] }],
    lineages: [
      {
        runId: owner.operationRunId,
        callId: f.event.callId,
        sources: [
          {
            kind: 'external_research',
            reference: source,
            research: {
              kind: 'generated_research',
              id: 'research-1',
              revision: 'r1',
              reference: research,
            },
          },
        ],
      },
    ],
  };
  expect(
    coldConversationToolEvents([turn], owner, snapshot, target)[0]!.sources,
  ).toEqual([source]);
  expect(
    coldConversationToolEvents([turn], owner, snapshot)[0]!.sources,
  ).toEqual([]);
  expect(
    coldConversationToolEvents([turn], owner, snapshot, () => ({
      ...research,
      sourceId: 'research-2',
    }))[0]!.sources,
  ).toEqual([]);
  expect(
    coldSnapshotResearchTarget(
      { ...scoped, ready: [], pending: scoped.ready },
      snapshot,
      owner,
    )(source, f.event.callId),
  ).toBeUndefined();
  expect(
    coldSnapshotResearchTarget(scoped, snapshot, {
      ...owner,
      operationRunId: 'other',
    })(source, f.event.callId),
  ).toBeUndefined();
});

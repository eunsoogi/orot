import type { SqlDatabase } from '@orot/storage';
import type { ConversationArtifact } from '../../../storage/conversationArtifactCodec';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { conversationHistoryPageOption } from '../conversationHistoryPageOption';
import { createConversationArtifactDiscovery } from '../conversationArtifactDiscovery';
import {
  selectConversationDisplayTurnIds,
  claimConversationFirstDisplay,
} from '../conversationFirstDisplaySelection';
import { createConversationSessionStorage } from '../conversationSessionStorage';
import { fingerprint } from '../evidenceUtils';
import { readHistoryObservationAliases } from '../readHistoryObservationAliases';
import { withConversationHistoryReadOperation } from '../conversationHistoryReadOperation';
import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';

const denseId = 'eligible-direct-root';

test('only the first owned display timeline batches the same explicitly selected artifact', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const data = {
      ...(await f.input.loadLocalData()),
      ...createLocalEvidenceData(f.database),
      repository: createLocalHealthEvidenceRepository(f.database),
    };
    const persistence = (await f.storage.read('newer'))!;
    const sources = [];
    for (const id of ['selected-observation-a', 'selected-observation-b']) {
      const row = { ...f.inside, id };
      await f.repository.put('health_observation', row);
      const revision = fingerprint(row);
      sources.push({
        reference: {
          sourceKind: 'personal_record' as const,
          sourceId: id,
          sourceRevision: revision,
          evidenceId: id,
          evidenceRevision: revision,
          effectiveTime: row.effectiveAt,
          reviewState: 'unknown' as const,
          locator: { kind: 'record' as const, id },
        },
        records: [{ kind: 'health_observation' as const, id, revision }],
      });
    }
    await f.storage.append({
      ...persistence,
      id: denseId,
      createdAt: '2026-10-07T00:00:00.000Z',
      sources,
      citations: sources.map(source => source.reference),
    });
    const discovery = createConversationArtifactDiscovery({
      database: f.database,
      data,
      storage: f.storage,
      registry: f.input.registry,
    });
    data.conversationArtifactDiscovery = async () => discovery;
    const open = createConversationSessionStorage(async () => data);
    const readPage = conversationHistoryPageOption(
      { ...f.input, loadLocalData: async () => data },
      open,
    );
    let batches = 0;
    const transaction = f.database.transaction.bind(f.database);
    f.database.transaction = work =>
      transaction(tx => {
        const execute = tx.execute.bind(tx);
        tx.execute = (sql, bindings) => {
          if (sql.includes(' AS history_alias_stale')) batches++;
          return execute(sql, bindings);
        };
        return work(tx);
      });
    const signal = new AbortController().signal;
    const first = await readPage('session', signal);
    expect(
      first.turns.find(turn => turn.toolMessageId === denseId)?.citations,
    ).toHaveLength(2);
    expect(batches).toBe(1);
    const version = (await f.storage.activeSessionVersion('session'))!;
    const older = await readPage('session', signal, {
      id: 'synthetic-cursor-above-root',
      createdAt: '2026-10-08T00:00:00.000Z',
      version,
      kind: 'turn',
    });
    expect(
      older.turns.find(turn => turn.toolMessageId === denseId)?.citations,
    ).toHaveLength(2);
    expect(batches).toBe(1);
    const targeted = await withConversationHistoryReadOperation(
      discovery,
      signal,
      scoped =>
        scoped.readSession({ sessionId: 'session', signal, ids: [denseId] }),
      true,
    );
    expect(targeted.items[0]?.citations).toHaveLength(2);
    expect(batches).toBe(1);
  } finally {
    f.close();
  }
});

test('the first-display receipt does not transfer between IDs, signals, or sessions', () => {
  const controller = new AbortController();
  const { signal } = controller;
  const ids = selectConversationDisplayTurnIds(
    [{ kind: 'turn', id: denseId }],
    'session',
    signal,
    true,
  );
  expect(Object.isFrozen(ids)).toBe(true);
  expect(claimConversationFirstDisplay([...ids], 'session', signal)).toBe(
    false,
  );
  expect(claimConversationFirstDisplay(ids, 'another', signal)).toBe(false);
  expect(
    claimConversationFirstDisplay(ids, 'session', new AbortController().signal),
  ).toBe(false);
  expect(claimConversationFirstDisplay(ids, 'session', signal)).toBe(true);
  expect(claimConversationFirstDisplay(ids, 'session', signal)).toBe(false);
  controller.abort();
  expect(claimConversationFirstDisplay(ids, 'session', signal)).toBe(false);
});

type Feature = Pick<
  ConversationArtifact,
  'entryIntent' | 'visitQuestions' | 'healthSummary'
>;
const source = {
  sourceKind: 'personal_record',
  sourceId: 'synthetic-visit',
} as NonNullable<ConversationArtifact['visitQuestions']>['source'];
const excluded: Feature[] = [
  { entryIntent: 'possibilities' },
  {
    visitQuestions: {
      appointmentId: 'synthetic-visit',
      source,
      candidates: [],
    },
  },
  {
    healthSummary: {
      summaryId: 'synthetic-summary',
      window: {
        fromInclusive: '2026-10-01T00:00:00Z',
        toExclusive: '2026-10-08T00:00:00Z',
        timeZone: 'UTC',
      },
    },
  },
];
test.each(excluded)(
  'retains feature-specific artifact hydration for %p',
  async feature => {
    const transaction = jest.fn();
    const database = { transaction } as unknown as SqlDatabase;
    const ordinary: ConversationArtifact = {
      id: 'synthetic-turn',
      sessionId: 'session',
      createdAt: '2026-10-07T00:00:00.000Z',
      providerId: 'synthetic',
      modelId: 'synthetic',
      status: 'complete',
      question: 'Synthetic question',
      answer: 'Synthetic answer',
      citations: [],
      sources: ['raw-a', 'raw-b'].map(id => ({
        reference: {
          sourceKind: 'personal_record',
          sourceId: id,
          sourceRevision: 'synthetic-revision',
          evidenceId: id,
          evidenceRevision: 'synthetic-revision',
          effectiveTime: null,
          reviewState: 'unknown',
          locator: { kind: 'record', id },
        },
        records: [
          { id, kind: 'health_observation', revision: 'synthetic-revision' },
        ],
      })),
    };
    await expect(
      readHistoryObservationAliases(
        { database, current: () => true },
        { ...ordinary, ...feature },
      ),
    ).resolves.toBeUndefined();
    expect(transaction).not.toHaveBeenCalled();
  },
);

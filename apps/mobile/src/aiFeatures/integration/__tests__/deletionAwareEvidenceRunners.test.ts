import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { ReviewState } from '@orot/domain';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { chunkStructuredRecord } from '@orot/rag';
import { openEncryptedStorage } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { runDiseaseHypothesisAnalysis } from '../../../diseaseHypotheses/task';
import { completeInventory } from '../../../diseaseHypotheses/taskTestSupport';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { runRagConversationTurn } from '../../../ragConversation/service';
import {
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  sourceRecord,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { openLocalStorage } from '../../../storage/secureDatabase';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { buildPersonalEvidence } from '../personalEvidence';
import {
  entry,
  healthObservation,
  inventory,
  noStaleEvidence,
  referenceOnly,
} from '../testSupport/personalEvidenceTestSupport';

jest.mock('@orot/agent-runtime', () => ({
  runMultiAgentWorkflow: jest.fn(),
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

type RunnerKind = 'disease' | 'rag';

const signal = new AbortController().signal;

async function runThroughDefaultRunner(
  kind: RunnerKind,
  item: EvidenceItem,
  registry: LocalEvidenceReferenceRegistry,
  resolveIdentity: (
    reference: EvidenceReference,
  ) => EvidenceReference | undefined,
): Promise<boolean | undefined> {
  let accepted: boolean | undefined;
  jest.mocked(runMultiAgentWorkflow).mockImplementation(async workflow => {
    const references = workflow.initialEvidence.items.map(referenceOnly);
    accepted = await workflow.revalidateEvidence(references, signal);
    return { status: 'needs_clarification' } as never;
  });
  const revalidate = (
    references: readonly EvidenceReference[],
    currentSignal: AbortSignal,
  ) => registry.revalidateEvidence(references, currentSignal);

  if (kind === 'disease') {
    await runDiseaseHypothesisAnalysis(
      {
        initialEvidence: { items: [item], coverage: [], conflicts: [] },
        revalidateEvidence: revalidate,
      } as never,
      completeInventory(),
      { signal },
      resolveIdentity,
    );
  } else {
    const reviewState: ReviewState = {
      status: 'reviewed',
      reviewerId: 'fixture-reviewer',
      reviewedAt: '2026-01-02T08:00:00.000Z',
    };
    const chunk = registry.toSearchChunk(item, item.content, reviewState);
    await runRagConversationTurn({
      question: '최근 기록은 무엇인가요?',
      previousMessages: [],
      loadCurrentEvidence: async () => ({
        batch: { items: [item], coverage: [], conflicts: [] },
        chunks: [chunk],
      }),
      rag: {
        search: async () => [{ chunk, score: 1 }],
      } as never,
      workflow: { revalidateEvidence: revalidate } as never,
      resolveLocalEvidenceIdentity: resolveIdentity,
    });
  }
  return accepted;
}

describe.each<RunnerKind>(['disease', 'rag'])(
  '%s default runner deletion-aware local references',
  kind => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('checks the resolved record identity, preserves the model alias, and rejects stale evidence', async () => {
      const directory = mkdtempSync(join(tmpdir(), 'orot-feature-alias-'));
      let database: SqlDatabase = createDatabase(
        join(directory, 'local.sqlite'),
      );
      try {
        const repository = await openEncryptedStorage(options(database));
        const source = await repository.sourceRecords.create(
          sourceRecord('feature-alias-source'),
        );
        const observation = healthObservation('feature-alias-evidence', [
          source.id,
        ]);
        await repository.put('health_observation', observation.record as never);
        jest.mocked(openLocalStorage).mockResolvedValue(repository);

        let currentChunks = [
          chunkStructuredRecord(
            'health_observation',
            observation.record as never,
          ),
        ];
        const registry = new LocalEvidenceReferenceRegistry();
        // Exercise the normal local-record builder so freshness checks read SQLCipher again.
        const snapshot = buildPersonalEvidence({
          inventory: inventory([entry('source_record', source), observation]),
          persistedChunks: currentChunks,
          loadCurrentPersistedChunks: async () => currentChunks,
          repository: createLocalHealthEvidenceRepository(database),
          registry,
          ...noStaleEvidence,
        });
        const item = snapshot.items[0];
        if (!item) throw new Error('Expected a built personal-record item.');
        const alias = referenceOnly(item);
        const registryRevalidator = jest.spyOn(registry, 'revalidateEvidence');
        expect(alias.sourceId).toBe('s1');
        expect(alias.evidenceId).toBe('e1');

        const resolveIdentity = (reference: EvidenceReference) =>
          registry.resolve(reference);
        await expect(
          runThroughDefaultRunner(kind, item, registry, resolveIdentity),
        ).resolves.toBe(true);
        expect(
          jest.mocked(runMultiAgentWorkflow).mock.calls.at(-1)?.[0]
            .initialEvidence.items[0],
        ).toMatchObject({ sourceId: 's1', evidenceId: 'e1' });
        expect(registryRevalidator).toHaveBeenCalledWith([alias], signal);

        const changedObservation = healthObservation(
          'feature-alias-evidence',
          [source.id],
          71.5,
        );
        await repository.put(
          'health_observation',
          changedObservation.record as never,
        );
        currentChunks = [
          chunkStructuredRecord(
            'health_observation',
            changedObservation.record as never,
          ),
        ];
        await expect(
          runThroughDefaultRunner(kind, item, registry, resolveIdentity),
        ).resolves.toBe(false);

        await repository.sourceRecords.delete(source.id);
        await expect(
          runThroughDefaultRunner(kind, item, registry, resolveIdentity),
        ).resolves.toBe(false);

        jest.mocked(openLocalStorage).mockClear();
        await expect(
          runThroughDefaultRunner(kind, item, registry, () => undefined),
        ).resolves.toBe(false);
        expect(openLocalStorage).not.toHaveBeenCalled();
      } finally {
        await database.closeAsync?.();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);

import type { EvidenceReference } from '@orot/agent-runtime';
import { runMultiAgentWorkflow } from '@orot/agent-runtime';
import { chunkStructuredRecord, chunkTranscriptSegment } from '@orot/rag';
import { openEncryptedStorage } from '@orot/storage';
import type { SqlDatabase } from '@orot/storage';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import {
  createDatabase,
  join,
  mkdtempSync,
  options,
  rmSync,
  audioSourceRecord,
  hashB,
  sourceRecord,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { transcriptSegment } from '../../../../../../packages/storage/__tests__/localQueryTestSupport';
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
import {
  runThroughDefaultRunner,
  signal,
  type RunnerKind,
} from '../testSupport/deletionAwareEvidenceRunnerTestSupport';

jest.mock('@orot/agent-runtime', () => ({
  runMultiAgentWorkflow: jest.fn(),
}));
jest.mock('../../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
  openLocalStorage: jest.fn(),
}));

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
        const transcriptSource = await repository.sourceRecords.create({
          ...audioSourceRecord('feature-alias-recording'),
          contentHash: hashB,
        });
        const observation = healthObservation('feature-alias-evidence', [
          source.id,
        ]);
        const transcript = transcriptSegment(transcriptSource.id);
        // The persisted question has its own row ID; transcript provenance supplies its deletion reference.
        const question = {
          id: 'feature-alias-question',
          effectiveAt: transcript.effectiveAt,
          recordedAt: transcript.recordedAt,
          ingestedAt: transcript.ingestedAt,
          provenance: {
            origin: 'derived' as const,
            sourceRecordIds: [transcript.id],
          },
          reviewState: { status: 'unreviewed' as const },
          questionText: 'Synthetic transcript question?',
          priority: 'routine' as const,
          evidenceSpanIds: [],
        };
        await repository.put('health_observation', observation.record as never);
        await repository.transcripts.append([transcript]);
        await repository.put('visit_question', question);
        jest.mocked(openLocalStorage).mockResolvedValue(repository);

        let currentChunks = [
          chunkStructuredRecord(
            'health_observation',
            observation.record as never,
          ),
          chunkTranscriptSegment(transcript),
        ];
        let currentObservation = observation;
        const buildSnapshot = (registry: LocalEvidenceReferenceRegistry) =>
          buildPersonalEvidence({
            inventory: inventory([
              entry('source_record', source),
              currentObservation,
              entry('source_record', transcriptSource),
              entry('transcript_segment', transcript),
              entry('visit_question', question),
            ]),
            persistedChunks: currentChunks,
            loadCurrentPersistedChunks: async () => currentChunks,
            repository: createLocalHealthEvidenceRepository(database),
            registry,
            ...noStaleEvidence,
          });
        const registry = new LocalEvidenceReferenceRegistry();
        // Exercise the normal local-record builder so freshness checks read SQLCipher again.
        const snapshot = buildSnapshot(registry);
        const item = snapshot.items[0];
        if (!item) throw new Error('Expected a built personal-record item.');
        const localRecordItem = snapshot.items.find(candidate =>
          candidate.content.includes(question.questionText),
        );
        if (!localRecordItem)
          throw new Error('Expected a transcript-backed visit question.');
        const alias = referenceOnly(item);
        const localRecordAlias = referenceOnly(localRecordItem);
        const registryRevalidator = jest.spyOn(registry, 'revalidateEvidence');
        expect(alias.sourceId).toBe('s1');
        expect(alias.evidenceId).toBe('e1');

        const resolveIdentity = (reference: EvidenceReference) =>
          registry.resolve(reference);
        expect(resolveIdentity(localRecordAlias)?.locator).toMatchObject({
          kind: 'local_record',
          recordKind: 'visit_question',
          recordId: question.id,
        });
        await expect(
          runThroughDefaultRunner(kind, item, registry, resolveIdentity),
        ).resolves.toBe(true);
        expect(
          jest.mocked(runMultiAgentWorkflow).mock.calls.at(-1)?.[0]
            .initialEvidence.items[0],
        ).toMatchObject({ sourceId: 's1', evidenceId: 'e1' });
        expect(registryRevalidator).toHaveBeenCalledWith([alias], signal);
        await expect(
          runThroughDefaultRunner(
            kind,
            localRecordItem,
            registry,
            resolveIdentity,
          ),
        ).resolves.toBe(true);
        expect(registryRevalidator).toHaveBeenCalledWith(
          [localRecordAlias],
          signal,
        );
        expect(
          jest.mocked(runMultiAgentWorkflow).mock.calls.at(-1)?.[0]
            .initialEvidence.items[0],
        ).toMatchObject({
          sourceId: localRecordAlias.sourceId,
          evidenceId: localRecordAlias.evidenceId,
          locator: localRecordAlias.locator,
        });

        const changedObservation = healthObservation(
          'feature-alias-evidence',
          [source.id],
          71.5,
        );
        await repository.put(
          'health_observation',
          changedObservation.record as never,
        );
        currentObservation = changedObservation;
        currentChunks = [
          chunkStructuredRecord(
            'health_observation',
            changedObservation.record as never,
          ),
          chunkTranscriptSegment(transcript),
        ];
        await expect(
          runThroughDefaultRunner(kind, item, registry, resolveIdentity),
        ).resolves.toBe(false);

        const currentRegistry = new LocalEvidenceReferenceRegistry();
        const currentSnapshot = buildSnapshot(currentRegistry);
        const currentQuestion = currentSnapshot.items.find(candidate =>
          candidate.content.includes(question.questionText),
        );
        if (!currentQuestion)
          throw new Error('Expected a current transcript-backed question.');
        const currentQuestionAlias = referenceOnly(currentQuestion);
        const currentIdentityResolver = (reference: EvidenceReference) =>
          currentRegistry.resolve(reference);
        const currentRegistryRevalidator = jest.spyOn(
          currentRegistry,
          'revalidateEvidence',
        );
        await expect(
          runThroughDefaultRunner(
            kind,
            currentQuestion,
            currentRegistry,
            currentIdentityResolver,
          ),
        ).resolves.toBe(true);
        expect(currentRegistryRevalidator).toHaveBeenCalledWith(
          [currentQuestionAlias],
          signal,
        );

        currentRegistryRevalidator.mockClear();
        await repository.sourceRecords.delete(transcriptSource.id);
        await expect(
          runThroughDefaultRunner(
            kind,
            currentQuestion,
            currentRegistry,
            currentIdentityResolver,
          ),
        ).resolves.toBe(false);
        expect(currentRegistryRevalidator).not.toHaveBeenCalled();

        jest.mocked(openLocalStorage).mockClear();
        await expect(
          runThroughDefaultRunner(
            kind,
            currentQuestion,
            currentRegistry,
            () => undefined,
          ),
        ).resolves.toBe(false);
        expect(openLocalStorage).not.toHaveBeenCalled();
      } finally {
        await database.closeAsync?.();
        rmSync(directory, { recursive: true, force: true });
      }
    });
  },
);

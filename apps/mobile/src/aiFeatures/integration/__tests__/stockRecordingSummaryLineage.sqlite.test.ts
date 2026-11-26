import { createRecordRepository, runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../../packages/storage/__tests__/sqliteTestDatabase';
import {
  join,
  mkdtempSync,
  rmSync,
  tmpdir,
} from '../../../../../../packages/storage/__tests__/sourceEvidenceTestSupport';
import { createLocalQueryProbeFixtures } from '../../../../e2e/localRecordQueryProbeFixtures';
import { createLocalEvidenceData } from '../../../healthEvidence/localEvidenceData';
import { createLocalHealthEvidenceRepository } from '../../../healthEvidence/localEvidenceRepository';
import { createConversationRecordingDraft } from '../../../ragConversation/conversationRecordingDraft';
import { createSelectedRecordingTranscriptTool } from '../../../conversationTools/selectedRecordingTranscriptTool';
import { createSummaryArtifactTool } from '../../../conversationTools/summaryArtifactTool';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';
import { createSymptomSummaryStorage } from '../../../storage/symptomSummaryStorage';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import type { AiFeatureLocalData } from '../localData';
import { localData } from '../featureServiceFixtures';
import { createSummaryArtifactDiscovery } from '../summaryArtifactDiscovery';
import { captureSymptomSummarySources } from '../symptomSummarySources';

const transcriptText = 'Synthetic identical transcript text';
const selectedSourceId = 'synthetic-chosen-recording';
const otherSourceId = 'synthetic-other-recording';
const summaryId = 'synthetic-generated-summary';

/** A second SQLite handle models a foreign writer; none of these fixtures claim
 * encryption, a native delivery ticket, or production ranking evidence. */
test('the stock catalog rejects revised transcript lineage even when the selected text and generated row bytes are unchanged', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'orot-stock-lineage-'));
  const path = join(directory, 'source.sqlite');
  const reader = openSqliteTestDatabase(path);
  const foreign = openSqliteTestDatabase(path);
  try {
    await reader.database.execute('PRAGMA journal_mode = WAL');
    await runMigrations(reader.database);
    const db = guardedNativeDatabase(reader.database);
    const original = createRecordRepository(db);
    const replacement = createRecordRepository(foreign.database);
    const fixture = createLocalQueryProbeFixtures();
    for (const sourceId of [selectedSourceId, otherSourceId]) {
      await original.put('source_record', {
        ...fixture.audioSource,
        id: sourceId,
        contentHash:
          'sha256:' + (sourceId === selectedSourceId ? 'a' : 'b').repeat(64),
      });
      await original.transcripts.append([
        {
          ...fixture.transcript,
          id: sourceId + ':transcript:r1',
          recordingSourceId: sourceId,
          transcriptId: sourceId + ':transcript',
          text: transcriptText,
          revision: 1,
          provenance: {
            ...fixture.transcript.provenance,
            sourceRecordIds: [sourceId],
          },
        },
      ]);
    }
    const store = createSymptomSummaryStorage(db);
    const data: AiFeatureLocalData = {
      ...localData([]).data,
      ...createLocalEvidenceData(db),
      repository: createLocalHealthEvidenceRepository(db),
      rag: {
        index: async () => {},
        search: async (_query, chunks, limit = 6) =>
          chunks.slice(0, limit).map(chunk => ({
            chunk,
            score: 1,
            lexicalRank: 1,
            vectorRank: 1,
          })),
      },
      summaryArtifactDiscovery: async registry =>
        createSummaryArtifactDiscovery({
          database: db,
          storage: store,
          data,
          registry,
        }),
    };
    const signal = new AbortController().signal;
    const recording = createConversationRecordingDraft(jest.fn());
    expect(recording.select({ key: selectedSourceId })).toBe(true);
    const lease = recording.claim(() => true);
    if (!lease?.admit())
      throw new Error('The synthetic selected turn was not admitted.');
    const transcript = new LocalEvidenceReferenceRegistry();
    const read = createSelectedRecordingTranscriptTool(data, transcript, lease);
    const request = {
      operationRunId: 'synthetic-stock-run',
      operationKey: 'tool-test',
      input: { query: 'Synthetic' },
      resultLimit: 4,
      maxPayloadBytes: 65536,
      allowedScope: { sourceKinds: ['personal_record'] as const },
      signal,
    };
    try {
      const result = await read.search(request);
      if ('status' in result)
        throw new Error('Selected transcript read failed');
      expect(result.items).toHaveLength(1);
      const oldReference = result.items[0]!;
      expect(oldReference.content).toContain(transcriptText);
      const captured = await captureSymptomSummarySources(
        {
          presentation: 'symptom_summary',
          hypotheses: [
            {
              title: 'Synthetic summary',
              summary: 'Synthetic retained interpretation',
              uncertainty: '',
              missingData: [],
              supportingEvidence: [oldReference],
              contraryEvidence: [],
            },
          ],
        },
        transcript,
        signal,
      );
      expect(captured.sources).toHaveLength(1);
      expect(captured.sources[0]).toMatchObject({
        records: expect.arrayContaining([
          expect.objectContaining({
            kind: 'source_record',
            id: selectedSourceId,
          }),
          expect.objectContaining({
            kind: 'transcript_segment',
            id: selectedSourceId + ':transcript:r1',
          }),
        ]),
      });
      expect(JSON.stringify(captured.sources)).not.toContain(otherSourceId);
      await store.append({
        ...captured,
        id: summaryId,
        createdAt: '2091-01-01T00:00:00Z',
        modelName: 'Synthetic',
        modelId: 'synthetic-model',
        providerId: 'synthetic-provider',
        inputLineage: 'complete',
      });

      const summaries = new LocalEvidenceReferenceRegistry();
      const tool = createSummaryArtifactTool(data, summaries);
      const generatedRequest = {
        ...request,
        allowedScope: { sourceKinds: ['generated_artifact'] as const },
      };
      const approved = await tool.search(generatedRequest);
      if ('status' in approved) throw new Error('Stock summary read failed');
      expect(approved.items).toHaveLength(1);
      expect(approved.items[0]?.content).toContain(
        'Synthetic retained interpretation',
      );
      const discovery = await data.summaryArtifactDiscovery!(summaries);
      const detail = await discovery.read(summaryId, signal);
      expect(detail?.sourceStatus).toBe('current');
      const verifyCurrentSummary = () =>
        discovery.revalidatePage(
          [{ id: summaryId, revision: detail!.metadata.revision }],
          signal,
        );
      expect(await verifyCurrentSummary()).toBe(true);
      const savedPayload = () =>
        db.execute(
          'SELECT result_json FROM symptom_summary_runs WHERE id = ?',
          [summaryId],
        );
      const before = (await savedPayload()).rows;
      expect(before).toHaveLength(1);

      await replacement.transcripts.correct(
        otherSourceId + ':transcript:r1',
        'Synthetic unrelated correction',
        '2091-01-02T00:00:00Z',
      );
      expect(await verifyCurrentSummary()).toBe(true);
      // Text equality cannot restore the old segment or the derivative's earlier source revision.
      const corrected = await replacement.transcripts.correct(
        selectedSourceId + ':transcript:r1',
        'Synthetic temporary correction',
        '2091-01-02T00:00:00Z',
      );
      const sameText = await replacement.transcripts.correct(
        corrected.id,
        transcriptText,
        '2091-01-03T00:00:00Z',
      );
      expect(sameText).toMatchObject({ text: transcriptText, revision: 3 });
      expect((await savedPayload()).rows).toEqual(before);
      expect(await store.read(summaryId)).toMatchObject({
        analysis: {
          hypotheses: [{ summary: 'Synthetic retained interpretation' }],
        },
      });
      expect(await transcript.revalidateEvidence([oldReference], signal)).toBe(
        false,
      );
      const stillCurrent = await verifyCurrentSummary();
      // Inspect a fresh tool invocation as well: a stored derivative must not
      // become transferable just because the parent payload is byte-identical.
      const fresh = createSummaryArtifactTool(
        data,
        new LocalEvidenceReferenceRegistry(),
      );
      const admitted = await fresh.search(generatedRequest).then(
        result =>
          'items' in result &&
          result.items.some(item =>
            item.content.includes('Synthetic retained interpretation'),
          ),
        (error: unknown) => {
          expect(error).toMatchObject({
            message: 'A saved summary changed during search.',
          });
          return false;
        },
      );
      expect({ stillCurrent, admitted }).toEqual({
        stillCurrent: false,
        admitted: false,
      });
    } finally {
      lease.release();
    }
  } finally {
    foreign.close();
    reader.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

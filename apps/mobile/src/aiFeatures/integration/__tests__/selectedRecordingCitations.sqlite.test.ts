import { createManualHistoryRepository } from '@orot/storage';
import { createSelectedRecordingTranscriptTool } from '../../../conversationTools/selectedRecordingTranscriptTool';
import { assertRetainedRecordsCurrent } from '../../../storage/retainedRecordFreshness';
import { captureEvidenceSources } from '../captureEvidenceSources';
import { createArchivedCitationService } from '../archivedCitationService';
import { captureColdRagConversationState } from '../coldRagConversationState';
import { createResearchInputTracker } from '../researchInputTracker';
import { LocalEvidenceReferenceRegistry } from '../evidenceRegistry';
import { createPrivateEvidenceRag } from '../privateEvidenceRag';
import { createRagConversationService } from '../ragConversationService';
import { publicEvidenceFixture } from '../testSupport/publicWebEvidenceTestSupport';
import {
  chosen,
  withRecordings,
} from '../testSupport/selectedRecordingSqliteFixture';

jest.mock('../../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: () => ({
    bridgeAvailable: true,
    protectedDataAvailable: async () => true,
  }),
}));

it('retires live aliases without poisoning the next cold capture and only exposes durable selected citations', () =>
  withRecordings(async (data, correct, storage) => {
    const sessionId = 'fixture:citation-owner';
    const turnId = 'fixture:selected-recording-turn';
    const createdAt = '2090-01-04T00:00:00.000Z';
    await storage.createSession(sessionId, await storage.currentGeneration());
    const registry = new LocalEvidenceReferenceRegistry();
    const loadData = async () => ({
      ...data,
      openConversationArtifactStorage: async () => storage,
      rag: createPrivateEvidenceRag(data.rag, registry),
    });
    const fixture = publicEvidenceFixture();
    const controller = new AbortController();
    let live = true;
    let oldAlias: import('@orot/agent-runtime').EvidenceReference | undefined;
    const send = createRagConversationService({
      consent: fixture.consent,
      queryConsent: { authorize: async () => 'authorized' },
      externalEvidence: { search: jest.fn() },
      loadLocalData: loadData,
      selectedAi: async () => fixture.selected,
      registry,
      ragRunner: async run => {
        const tool = run.workflow.tools[0]!;
        const result = await tool.search({
          operationRunId: 'fixture:turn',
          operationKey: 'fixture:tool',
          input: { query: 'synthetic transcript' },
          allowedScope: { sourceKinds: ['personal_record'] },
          resultLimit: 2,
          maxPayloadBytes: 4096,
          signal: controller.signal,
        });
        if (!('items' in result) || result.items.length !== 1)
          throw new Error('expected selected excerpt');
        const { content, ...ref } = result.items[0]!;
        expect(content).toContain('selected revision');
        oldAlias = ref;
        run.onValidatedEvidence?.([ref]);
        return {
          status: 'answer',
          answer: 'Synthetic answer from selected recording.',
          citations: [ref],
        };
      },
    });
    const before = registry.snapshot();
    const result = await send(
      'What does the selected recording say?',
      [],
      controller.signal,
      {
        selectedRecordingTranscript: {
          sourceId: chosen,
          signal: new AbortController().signal,
          isCurrent: () => live,
        },
        retentionSession: { id: sessionId, version: 0 },
        retentionRequestId: turnId,
        retentionRequestCreatedAt: createdAt,
        onRetentionCandidate: async candidate => {
          await storage.append({
            ...candidate,
            id: turnId,
            sessionId,
            createdAt,
            status: 'complete',
          });
        },
      },
    );
    expect(result.status).toBe('answer');
    if (
      result.status !== 'answer' ||
      !result.committedRecordingCitations ||
      !oldAlias
    )
      throw new Error('expected committed selected citation');
    expect(result.citations).toEqual([]);
    live = false;
    expect(registry.resolve(oldAlias)).toBeUndefined();
    expect(registry.snapshot()).toEqual(before);
    const cold = await captureColdRagConversationState({
      registry,
      tracker: createResearchInputTracker(registry),
      external: { snapshot: () => null } as unknown as Parameters<
        typeof captureColdRagConversationState
      >[0]['external'],
      sessionId,
      operationRunId: 'fixture:next-ordinary-turn',
      knownCallIds: [],
      batches: [],
      options: {
        request: 'next ordinary conversation',
        task: { taskType: 'rag-conversation', taskVersion: '1' },
      } as unknown as Parameters<
        typeof captureColdRagConversationState
      >[0]['options'],
      signal: controller.signal,
    });
    expect(cold.sources).toEqual([]);
    expect(JSON.stringify(cold)).not.toMatch(
      /selected-audio-source|selected revision/,
    );
    const archive = createArchivedCitationService(loadData);
    const opened = await archive.resolve(
      result.committedRecordingCitations.target,
      0,
      controller.signal,
    );
    if (opened?.kind !== 'detail') throw new Error('expected saved source');
    expect(
      await archive.read(opened.owner, opened.reference, controller.signal),
    ).toMatchObject({ status: 'available' });
    await correct();
    expect(
      await archive.read(opened.owner, opened.reference, controller.signal),
    ).toMatchObject({ status: 'unavailable' });
  }));

it('keeps immutable predecessors only under the exact cited current transcript and recording', () =>
  withRecordings(async (data, correct, _storage, database) => {
    const registry = new LocalEvidenceReferenceRegistry();
    const signal = new AbortController().signal;
    const tool = createSelectedRecordingTranscriptTool(data, registry, {
      sourceId: chosen,
      isCurrent: () => true,
    });
    const batch = await tool.search({
      operationRunId: 'synthetic-transcript',
      operationKey: 'synthetic-tool',
      input: { query: 'Synthetic' },
      allowedScope: { sourceKinds: ['personal_record'] },
      resultLimit: 1,
      maxPayloadBytes: 4096,
      signal,
    });
    if ('status' in batch || batch.items.length !== 1)
      throw new Error('expected one synthetic selected excerpt');
    const { sources } = await captureEvidenceSources(
      batch.items,
      registry,
      signal,
    );
    const source = sources[0];
    if (!source || !('records' in source))
      throw new Error('expected captured transcript storage identity');
    const { reference, records } = source;
    const predecessor = records.find(
      row =>
        row.kind === 'transcript_segment' && row.id !== reference.evidenceId,
    );
    if (!predecessor) throw new Error('expected exact immutable predecessor');
    const verify = (candidate = reference) =>
      database.transaction(tx =>
        assertRetainedRecordsCurrent(
          tx,
          records,
          createManualHistoryRepository(database),
          candidate,
        ),
      );

    await expect(verify()).resolves.toBeUndefined();
    // A current row in the same batch cannot launder the cited historical one.
    await expect(
      verify({
        ...reference,
        evidenceId: predecessor.id,
        evidenceRevision: predecessor.revision,
      }),
    ).rejects.toThrow('A cited source is stale.');
    await expect(
      verify({
        ...reference,
        sourceId: 'synthetic-foreign-recording',
      }),
    ).rejects.toThrow('A cited source is stale.');
    await correct();
    await expect(verify()).rejects.toThrow('A cited source is stale.');
  }));

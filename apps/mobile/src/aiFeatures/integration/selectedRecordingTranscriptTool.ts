import type { EvidenceSearchTool } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { AiFeatureLocalData } from './localData';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createLocalEvidenceSearchTool } from './evidenceSearchTool';
import { createLocalEvidenceSnapshot } from './evidenceSnapshot';
import { indexChangedFeatureEvidence } from './featureEvidenceSnapshot';

type Selection = NonNullable<
  RagConversationObserver['selectedRecordingTranscript']
>;

/** Exactly one app-selected saved recording; raw source IDs are never model parameters. */
export function createSelectedRecordingTranscriptTool(
  data: AiFeatureLocalData,
  registry: LocalEvidenceReferenceRegistry,
  selected: Selection,
  protectedCurrent: () => Promise<boolean> = async () => selected.isCurrent(),
): EvidenceSearchTool {
  const { sourceId, isCurrent } = selected;
  const tool = createLocalEvidenceSearchTool({
    id: 'local-saved-recording-transcript',
    sourceKind: 'personal_record',
    maxResults: 6,
    rag: data.rag,
    registry,
    prepareChunks: (chunks, signal) =>
      indexChangedFeatureEvidence(data, { chunks }, signal),
    async loadSnapshot(query, request) {
      const { signal, allowedScope } = request;
      const current = () => !signal.aborted && isCurrent();
      if (!current() || !(await protectedCurrent()) || !current())
        throw new Error('Selected recording expired.');
      if (!allowedScope.sourceKinds.includes('personal_record'))
        throw new Error('Selected transcript access is not allowed.');
      const allowed =
        allowedScope.sourceIds &&
        registry.localSourceIds(allowedScope.sourceIds);
      if (allowed && !allowed.includes(sourceId))
        throw new Error('Selected recording is out of scope.');
      const snapshot = await data.readCandidates(query, signal, {
        selection: 'saved_recording_transcript',
        sourceIds: [sourceId],
        ...(allowedScope.timeRange
          ? { timeRange: allowedScope.timeRange }
          : {}),
      });
      if (!current() || !(await protectedCurrent()) || !current())
        throw new Error('Selected recording expired.');
      // Fail closed on any inconsistent adapter result instead of widening the tool.
      const record = snapshot.dependencies[0];
      if (
        snapshot.dependencies
          .slice(1)
          .some(
            item =>
              item.kind !== 'transcript_segment' ||
              item.record.recordingSourceId !== sourceId,
          ) ||
        record?.kind !== 'source_record' ||
        record.record.id !== sourceId ||
        record.record.sourceKind !== 'audio_recording' ||
        snapshot.candidates.some(
          item =>
            item.kind !== 'transcript_segment' ||
            item.record.recordingSourceId !== sourceId,
        )
      )
        throw new Error('Invalid selected recording snapshot.');
      const ids = snapshot.candidates.map(item => ({
        kind: item.kind,
        id: item.record.id,
      }));
      const chunks = await data.loadCurrentChunks(ids, signal);
      const stale = await data.loadStaleArtifacts(ids, signal);
      if (!current() || !(await protectedCurrent()) || !current())
        throw new Error('Selected recording expired.');
      for (const id of await data.findIdentifiers(
        JSON.stringify(snapshot.candidates),
        signal,
      ))
        registry.registerSensitiveIdentifier(id);
      if (!current() || !(await protectedCurrent()) || !current())
        throw new Error('Selected recording expired.');
      return createLocalEvidenceSnapshot({
        inventory: snapshot.catalog,
        records: [...snapshot.dependencies, ...snapshot.candidates],
        candidateRecords: snapshot.candidates,
        hasMoreCandidates: snapshot.hasMoreCandidates,
        persistedChunks: chunks,
        loadCurrentPersistedChunks: async () =>
          isCurrent() ? data.loadCurrentChunks(ids) : [],
        staleArtifacts: stale,
        loadCurrentStaleArtifacts: () => data.loadStaleArtifacts(ids),
        repository: data.repository,
        memoryRecords: [],
        memoryStorage: data.memoryStorage,
        registry,
      });
    },
  });
  return {
    ...tool,
    description:
      'Search current transcript excerpts of the one saved recording the user selected for this Conversation turn. Return cited excerpts only. Do not guess the recording or claim complete coverage.',
    async search(request, runtime) {
      if (
        request.signal.aborted ||
        !isCurrent() ||
        !(await protectedCurrent()) ||
        !isCurrent()
      )
        throw new Error('Selected recording expired.');
      const result = await tool.search(request, runtime);
      if (
        request.signal.aborted ||
        !isCurrent() ||
        !(await protectedCurrent()) ||
        !isCurrent()
      )
        throw new Error('Selected recording expired.');
      return result;
    },
  };
}

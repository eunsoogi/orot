import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationRetentionCandidate } from '../../ragConversation/conversationRetention';
import type { AiFeatureLocalData } from './localData';
import { currentRecordingProtection } from '../../ragConversation/conversationRecordingPickerPage';

/** Only the local selected-turn retention path marks canonical transcript citations. */
export function bindSelectedRecordingArchive(
  candidate: ConversationRetentionCandidate,
): ConversationRetentionCandidate {
  const bind = (reference: EvidenceReference): EvidenceReference => {
    const locator = reference.locator;
    if (
      reference.sourceKind !== 'personal_record' ||
      !locator ||
      typeof locator !== 'object' ||
      Array.isArray(locator)
    )
      throw new Error('Selected recording citation is not a local transcript.');
    return { ...reference, locator: { ...locator, selectedRecording: true } };
  };
  return {
    ...candidate,
    citations: candidate.citations.map(bind),
    sources: candidate.sources.map(source => ({
      ...source,
      reference: bind(source.reference),
    })),
  };
}

/** A stored reference is not authority to display a superseded selected transcript chunk. */
export async function selectedRecordingArchiveIsCurrent(
  data: AiFeatureLocalData,
  reference: EvidenceReference,
  signal: AbortSignal,
) {
  const locator = reference.locator;
  if (
    !locator ||
    typeof locator !== 'object' ||
    Array.isArray(locator) ||
    !('selectedRecording' in locator) ||
    locator.selectedRecording !== true
  )
    return true;
  if (
    reference.sourceKind !== 'personal_record' ||
    signal.aborted ||
    !(await currentRecordingProtection())
  )
    return false;
  const chunks = await data.loadCurrentChunks(
    [{ kind: 'transcript_segment', id: reference.evidenceId }],
    signal,
  );
  return (
    !signal.aborted &&
    chunks.some(
      chunk =>
        chunk.metadata.evidenceId === reference.evidenceId &&
        chunk.metadata.sourceId === reference.sourceId,
    ) &&
    (await currentRecordingProtection()) &&
    !signal.aborted
  );
}

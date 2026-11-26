import type { RecordRepository } from '@orot/storage';
import { requireEncounterActive } from '@orot/agent-runtime';
import type { EncounterPending } from '@orot/agent-runtime';
import { encounterConflicts } from '../agent/encounter/conflicts';
import { readLongTranscriptReview } from '../agent/encounter/longTranscriptReviewRead';
import { validateLongEncounterCandidates } from '../agent/encounter/validateLongEncounterCandidates';

/** Validate the whole visible candidate set against one current recording transaction. */
export function proveLongEncounterPending(
  repository: RecordRepository,
  snapshot: EncounterPending,
  signal: AbortSignal,
) {
  return repository.transaction(async (writer, sql) => {
    if (!sql) throw new Error('Canonical storage required.');
    const transcript = await readLongTranscriptReview(
      writer,
      sql,
      snapshot,
      () => requireEncounterActive(signal),
    );
    validateLongEncounterCandidates(snapshot.candidates, transcript);
    snapshot.conflicts = await encounterConflicts(writer, snapshot.candidates);
    return snapshot;
  });
}

import { validateEncounterCandidates } from '@orot/agent-runtime';

/** Completed on-device review merges independently bounded model batches.
 * A duplicate ID across batches must fail, including at explicit Save. */
export function validateLongEncounterCandidates(
  candidates: Parameters<typeof validateEncounterCandidates>[0],
  transcript: Parameters<typeof validateEncounterCandidates>[1],
) {
  if (
    !Array.isArray(candidates) ||
    new Set(candidates.map(candidate => candidate.id)).size !==
      candidates.length
  )
    throw new Error('Invalid encounter candidate identities.');
  for (let start = 0; start < candidates.length; start += 32)
    validateEncounterCandidates(
      candidates.slice(start, start + 32),
      transcript,
    );
}

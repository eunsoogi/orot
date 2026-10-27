import type {
  EncounterApproval,
  EncounterCandidate,
  EncounterPending,
  EncounterTranscript,
} from './contracts';

/** Canonical equality binds snapshots despite JSON object-key order changes on checkpoint restore. */
export function encounterCanonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(encounterCanonical).join(',') + ']';
  const record = value as Record<string, unknown>;
  return (
    '{' +
    Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => JSON.stringify(key) + ':' + encounterCanonical(record[key]))
      .join(',') +
    '}'
  );
}

export function requireEncounterActive(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Encounter processing cancelled.');
}

export function encounterReferences(transcript: EncounterTranscript) {
  return transcript.segments.map(({ text: _text, ...reference }) => reference);
}

/** Exact UTF-16 ranges bind the extracted quote to a current transcript revision. */
export function validateEncounterCandidates(
  candidates: EncounterCandidate[],
  transcript: EncounterTranscript,
): void {
  if (
    !Array.isArray(candidates) ||
    candidates.length > 32 ||
    new Set(candidates.map((candidate) => candidate.id)).size !== candidates.length
  )
    throw new Error('Invalid encounter candidates.');
  for (const candidate of candidates) {
    if (
      !candidate.id ||
      !['medication', 'plan'].includes(candidate.kind) ||
      !candidate.text?.trim() ||
      candidate.text.length > 2000 ||
      candidate.speaker !== 'unknown' ||
      (candidate.dosageInstruction !== undefined &&
        (candidate.kind !== 'medication' ||
          !candidate.dosageInstruction.trim() ||
          candidate.dosageInstruction.length > 1000)) ||
      !Array.isArray(candidate.evidence) ||
      !candidate.evidence.length ||
      candidate.evidence.length > 8
    )
      throw new Error('Invalid encounter candidate.');
    for (const evidence of candidate.evidence) {
      const segment = transcript.segments.find((item) => item.id === evidence.segmentId);
      if (
        !segment ||
        !Number.isSafeInteger(evidence.startOffset) ||
        !Number.isSafeInteger(evidence.endOffset) ||
        evidence.startOffset < 0 ||
        evidence.endOffset <= evidence.startOffset ||
        evidence.endOffset > segment.text.length ||
        !evidence.quote?.trim() ||
        segment.text.slice(evidence.startOffset, evidence.endOffset) !== evidence.quote
      )
        throw new Error('Invalid encounter evidence.');
    }
  }
}

/** Editing can omit a candidate or change its text, but cannot swap evidence, kind, identity or speaker. */
export function validateEncounterApproval(
  pending: EncounterPending,
  approval: EncounterApproval,
): void {
  if (
    encounterCanonical(approval.pending) !== encounterCanonical(pending) ||
    !['approve', 'deny'].includes(approval.decision) ||
    !approval.reviewerId?.trim() ||
    !Number.isFinite(Date.parse(approval.reviewedAt)) ||
    !Array.isArray(approval.candidates) ||
    new Set(approval.candidates.map((candidate) => candidate.id)).size !==
      approval.candidates.length
  )
    throw new Error('Approval does not match the pending encounter.');
  for (const candidate of approval.candidates) {
    const original = pending.candidates.find((item) => item.id === candidate.id);
    if (
      !original ||
      encounterCanonical({
        ...candidate,
        text: original.text,
        dosageInstruction: original.dosageInstruction,
      }) !== encounterCanonical(original)
    )
      throw new Error('Approval changed candidate identity or evidence.');
  }
}

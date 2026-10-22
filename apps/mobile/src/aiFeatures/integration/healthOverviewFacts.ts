import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { healthSourceSemantics } from './healthSourceSemantics';

const fields = [
  'effectiveAt',
  'endedAt',
  'displayText',
  'medicationName',
  'dosageInstruction',
  'assertionKind',
  'hasSchedule',
  'isArchived',
  'eventKind',
  'observationStatus',
  'scheduledAt',
  'scheduleType',
  'dose',
  'concept',
  'value',
  'description',
  'severity',
  'startedAt',
  'resolvedAt',
  'status',
  'note',
] as const;

/** Preserve domain facts while decoding categorical values; originals remain in storage and source detail. */
export function healthOverviewFacts(entry: LocalHealthEvidenceRecord) {
  const record = entry.record as unknown as Record<string, unknown>;
  const facts: Record<string, unknown> = { kind: entry.kind };
  for (const field of fields) {
    if (record[field] !== undefined) facts[field] = record[field];
  }
  if (facts.value && typeof facts.value === 'object') {
    // An unavailable source display is not an unavailable normalized quantity or unit.
    facts.value = Object.fromEntries(
      Object.entries(facts.value).filter(
        ([field]) => field !== 'sourceRepresentation',
      ),
    );
  }
  const semantics = healthSourceSemantics(entry);
  if (semantics) facts.sourceSemantics = semantics;
  if (typeof semantics?.sleepStage === 'string') {
    // A HealthKit enum such as 3 or 5 is a stage, not an amount or episode count.
    facts.value = { kind: 'text', text: semantics.sleepStage };
  }
  return facts;
}

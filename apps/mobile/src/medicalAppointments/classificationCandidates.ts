import type { CalendarEvent } from '../calendar/types';
import type { CandidateReview } from './classificationWorkflow';
import type { AppointmentClassification } from './classificationTask';
import { medicalAppointmentCopy } from './copy.ko';

/** Resolve locale copy once per run; formatting a shared reason per event delays the first request. */
export function createClassificationCandidates(
  events: readonly CalendarEvent[],
): CandidateReview[] {
  const reason = medicalAppointmentCopy.manualReview;
  return events.map((event, index) => ({
    candidateId: `calendar-candidate-${index + 1}`,
    event,
    status: 'unclassified',
    reason,
  }));
}

/** Inspect only the completed batch while preserving immutable snapshots already delivered to the screen. */
export function applyClassificationBatch(
  candidates: readonly CandidateReview[],
  start: number,
  results: readonly AppointmentClassification[],
): CandidateReview[] {
  const byId = new Map(results.map(result => [result.candidateId, result]));
  const updated = candidates.slice();
  for (let index = start; index < start + results.length; index += 1) {
    const candidate = candidates[index]!;
    const result = byId.get(candidate.candidateId);
    if (result)
      updated[index] = { ...candidate, ...result, status: 'classified' };
  }
  return updated;
}

import { projectConversationToolEvent } from '@orot/agent-runtime';
import { parseHealthContextScope } from '../healthEvidence/healthContext/scope';
import type { FilteredToolPeriod } from './conversationToolFilteredPeriod';

/** Project untrusted JSON to the bounded filtered-period descriptor. */
export function decodeFilteredToolPeriod(
  value: unknown,
): FilteredToolPeriod | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  if (
    raw.kind !== 'filtered_medication_period' ||
    !raw.reference ||
    typeof raw.reference !== 'object'
  )
    return null;
  const scope = parseHealthContextScope(raw.scope);
  if (
    !scope ||
    scope.topic !== 'medications' ||
    !scope.window.doseHistory ||
    scope.window.doseHistory.medicationName !== undefined ||
    (raw.anchorKey !== null &&
      (typeof raw.anchorKey !== 'string' ||
        !/^[a-f0-9]{2,16}$/u.test(raw.anchorKey))) ||
    typeof raw.revision !== 'string' ||
    !/^[a-f0-9]{2,16}$/u.test(raw.revision) ||
    !Number.isSafeInteger(raw.mutationGeneration) ||
    Number(raw.mutationGeneration) < 0 ||
    !Number.isSafeInteger(raw.deletionGeneration) ||
    Number(raw.deletionGeneration) < 0
  )
    return null;
  const event = projectConversationToolEvent({
    version: 1,
    operationRunId: 'run',
    callId: 'call',
    toolName: 'tool',
    order: 0,
    status: 'completed',
    inputSummary: { sourceKind: 'personal_record' },
    sources: [raw.reference],
  });
  const ref = event?.sources[0];
  if (!ref || ref.sourceKind !== 'personal_record') return null;
  return {
    kind: 'filtered_medication_period',
    reference: {
      ...ref,
      locator: null,
      effectiveTime: null,
      reviewState: 'unknown',
    },
    scope,
    anchorKey: raw.anchorKey as string | null,
    revision: raw.revision,
    mutationGeneration: raw.mutationGeneration as number,
    deletionGeneration: raw.deletionGeneration as number,
  };
}

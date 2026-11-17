import type { Appointment } from '@orot/domain';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import { loadVisitQuestionsContext } from './visitQuestionsContextLoader';

/** Preparation loads the appointment and local services, not model-selected records.
 * Keep outbound search and model dispatch outside this overlap-safe phase. */
export async function prepareVisitRouteContext(
  appointmentId: string,
  signal: AbortSignal,
) {
  const { prepareUpcomingVisitQuestionContext } =
    await loadVisitQuestionsContext();
  if (signal.aborted) return { status: 'cancelled' as const };
  return prepareUpcomingVisitQuestionContext({
    now: new Date().toISOString(),
    appointmentId,
    signal,
    maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems - 3,
  });
}

/** A selected appointment must not silently become a different visit or revision. */
export function samePreparedVisit(current: Appointment, expected: Appointment) {
  return (
    current.id === expected.id &&
    localEvidenceFingerprint(current) === localEvidenceFingerprint(expected)
  );
}

/** Local overlap adds a wait after preparation, so recheck the appointment and owner
 * after that wait and before any public-search disclosure or main-model consent. */
export async function finishVisitPreparation(
  context: Extract<
    Awaited<ReturnType<typeof prepareVisitRouteContext>>,
    { status: 'ready' }
  >,
  input: {
    signal: AbortSignal;
    beforeResearch?: () => Promise<boolean>;
    isCurrentOwner?: () => boolean;
  },
): Promise<'ready' | 'cancelled' | 'refresh_required'> {
  const current = () =>
    !input.signal.aborted && input.isCurrentOwner?.() !== false;
  if (input.beforeResearch && !(await input.beforeResearch()))
    return 'cancelled';
  if (!current()) return 'cancelled';
  if (input.beforeResearch) {
    const fresh = await context.revalidateEvidence([], { allowEmpty: true });
    if (!current()) return 'cancelled';
    if (!fresh) return 'refresh_required';
  }
  return 'ready';
}

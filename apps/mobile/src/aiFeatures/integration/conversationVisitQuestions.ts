import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import { generateInlineVisitReview } from '../../nextVisitQuestions/inlineVisitGeneration';
import type { Appointment } from '@orot/domain';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { AiFeatureServices } from './featureServices';
import type { SelectedAiResolution } from './provider';
import type { VisitQuestionRouteOperations } from './visitQuestionsRouteOperations';

/** Bind each generation to the selected visit and one conversation message's existing review. */
export async function generateConversationVisitQuestions(input: {
  readonly ownerKey: string;
  readonly appointmentId?: string;
  readonly request: string;
  readonly expectedAppointment?: Appointment;
  readonly operations: VisitQuestionRouteOperations;
  readonly loadSaved: AiFeatureServices['loadSavedVisitQuestions'];
  readonly resolveSelectedAi: () => Promise<SelectedAiResolution>;
  readonly generatedArtifactTools?: AiFeatureServices['generatedArtifactTools'];
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly isCurrentOwner: () => boolean;
  readonly signal: AbortSignal;
  readonly observer?: AiWorkflowObserver;
  readonly registerToolSource?: AiFeatureServices['registerVisitQuestionSource'];
}) {
  const current = () => !input.signal.aborted && input.isCurrentOwner();
  if (!current()) return { status: 'cancelled' as const };
  // A conversation without an explicit visit must not silently select another appointment.
  if (!input.appointmentId?.trim())
    return { status: 'no_appointment' as const };
  const appointment = await input.operations.loadAppointment(
    new Date().toISOString(),
    input.appointmentId,
  );
  if (!current()) return { status: 'cancelled' as const };
  if (!appointment) return { status: 'no_appointment' as const };
  if (
    input.expectedAppointment &&
    localEvidenceFingerprint(input.expectedAppointment) !==
      localEvidenceFingerprint(appointment)
  )
    return { status: 'appointment_changed' as const };
  const selectedAi = await input.resolveSelectedAi();
  if (!current()) return { status: 'cancelled' as const };
  if (selectedAi.status !== 'ready')
    return { status: 'provider_unavailable' as const };
  const outcome = await generateInlineVisitReview({
    ownerKey: input.ownerKey,
    appointmentId: appointment.id,
    loadSaved: input.loadSaved,
    isCurrentOwner: input.isCurrentOwner,
    signal: input.signal,
    generate: () =>
      input.operations.generate({
        appointment,
        request: input.request,
        selectedAi,
        signal: input.signal,
        confirmConsent: input.confirmConsent,
        generatedArtifactTools: input.generatedArtifactTools,
        observer: input.observer,
        registerToolSource: input.registerToolSource,
      }),
  });
  return outcome.status === 'ready'
    ? { ...outcome, appointment, selectedAi }
    : outcome;
}

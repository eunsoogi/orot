import type { ExecutionConsentPort } from '@orot/agent-runtime';
import { createPreparedOpeningConsent } from './preparedOpeningConsent';
import { observeVisitPreflight } from './visitPreflightDiagnostics';
import { conversationConsentScope } from './conversationBackgroundProvider';
import { conversationReceiptSelection } from './conversationReceiptSelection';
import { startContextualConversationOpening } from './contextualConversationOpening';
import { visitConsentScope } from '../../agent/execution/inferenceConsentScopes';
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
  readonly consent?: ExecutionConsentPort;
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly isCurrentOwner: () => boolean;
  readonly signal: AbortSignal;
  readonly observer?: AiWorkflowObserver;
  readonly registerToolSource?: AiFeatureServices['registerVisitQuestionSource'];
}) {
  // Keep the actual authorization port and its exact-request live fences intact.
  const consent = conversationConsentScope(
    input.consent ?? {
      authorize: async request =>
        (await input.confirmConsent(request))
          ? ('authorized' as const)
          : ('renewal_required' as const),
    },
    input.observer,
  );
  const confirmConsent = async (request: OutboundProcessingRequest) =>
    (await consent.authorize(request)) === 'authorized';
  const current = () => !input.signal.aborted && input.isCurrentOwner();
  if (!current()) return { status: 'cancelled' as const };
  // The generic next-visit action resolves the upcoming confirmed appointment.
  // An explicit but invalid target must never fall back to another appointment.
  if (input.appointmentId !== undefined && !input.appointmentId.trim())
    return { status: 'no_appointment' as const };
  const appointment = await observeVisitPreflight('preflight_appointment', () =>
    input.operations.loadAppointment(
      new Date().toISOString(),
      input.appointmentId,
    ),
  );
  if (!current()) return { status: 'cancelled' as const };
  if (!appointment) return { status: 'no_appointment' as const };
  if (
    input.expectedAppointment &&
    localEvidenceFingerprint(input.expectedAppointment) !==
      localEvidenceFingerprint(appointment)
  )
    return { status: 'appointment_changed' as const };
  const selectedAi = conversationReceiptSelection(
    await observeVisitPreflight('preflight_selection', input.resolveSelectedAi),
    input.observer,
  );
  if (!current()) return { status: 'cancelled' as const };
  if (selectedAi.status !== 'ready')
    return { status: 'provider_unavailable' as const };
  let opening:
    ReturnType<typeof startContextualConversationOpening> | undefined;
  const gate = createPreparedOpeningConsent(consent, 'visit');
  try {
    const outcome = await generateInlineVisitReview({
      ownerKey: input.ownerKey,
      appointmentId: appointment.id,
      loadSaved: id =>
        observeVisitPreflight('preflight_saved', () => input.loadSaved(id)),
      isCurrentOwner: input.isCurrentOwner,
      signal: input.signal,
      generate: async () => {
        opening = startContextualConversationOpening({
          diagnosticFeature: 'visit',
          selected: selectedAi,
          request: input.request,
          observer: input.observer,
          signal: input.signal,
          consentScope: visitConsentScope,
          isCurrent: current,
          consent: gate.port,
        });
        // Start local preparation immediately, but reveal opening consent only after
        // preparation succeeds. A local failure must not dismiss a visible prompt.
        const openingDone = observeVisitPreflight(
          'preflight_opening',
          () => opening!.done,
        );
        return input.operations.generate({
          appointment,
          isCurrentOwner: current,
          beforeResearch: async () => {
            gate.release(current());
            await openingDone;
            return current();
          },
          request: input.request,
          selectedAi,
          signal: input.signal,
          confirmConsent,
          consent,
          generatedArtifactTools: input.generatedArtifactTools,
          observer: input.observer,
          registerToolSource: input.registerToolSource,
        });
      },
    });
    return outcome.status === 'ready'
      ? { ...outcome, appointment, selectedAi }
      : outcome;
  } finally {
    gate.release(false);
    opening?.dispose();
  }
}

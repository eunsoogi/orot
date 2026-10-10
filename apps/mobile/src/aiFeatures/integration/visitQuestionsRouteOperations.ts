import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import { AppointmentSchema } from '@orot/domain';
import type { Appointment } from '@orot/domain';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import type { VisitQuestionEvidenceCollection } from '../../agent/visitQuestions/evidenceCollection';
import { runVisitQuestionWorkflow } from '../../agent/visitQuestions/workflow';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { ProviderSelection } from '../../providers/selection/types';
import type { SelectedAiResolution } from './provider';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import type {
  EvidenceCaveat,
  GenerationOutcome,
} from '../../nextVisitQuestions/types';
import { saveVisitQuestionRoute } from './visitQuestionsRouteSave';
import type {
  VisitQuestionRouteSaveInput,
  VisitQuestionRouteSaveResult,
} from './visitQuestionsRouteSave';

type ReadySelection = Extract<SelectedAiResolution, { status: 'ready' }>;
type PreparedContext = Awaited<
  ReturnType<
    typeof import('../../agent/visitQuestions/localContext').prepareUpcomingVisitQuestionContext
  >
>;
type ReadyContext = Extract<PreparedContext, { status: 'ready' }>;
type ReadyGeneration = Extract<
  GenerationOutcome<VisitQuestionEvidenceItem>,
  { status: 'ready' }
>;

export type VisitQuestionRouteGeneration =
  | (ReadyGeneration & {
      readonly validateSource: (
        reference: VisitQuestionEvidenceItem,
        signal: AbortSignal,
      ) => Promise<boolean>;
    })
  | Exclude<GenerationOutcome<VisitQuestionEvidenceItem>, { status: 'ready' }>;

export interface VisitQuestionRouteGenerationInput {
  readonly appointment: Appointment;
  readonly selectedAi: ReadySelection;
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly signal: AbortSignal;
}

export interface VisitQuestionRouteOperations {
  loadAppointment(now: string): Promise<Appointment | null>;
  generate(
    input: VisitQuestionRouteGenerationInput,
  ): Promise<VisitQuestionRouteGeneration>;
  save(
    input: VisitQuestionRouteSaveInput,
  ): Promise<VisitQuestionRouteSaveResult>;
}

function currentEvidenceCaveats(
  collections: readonly VisitQuestionEvidenceCollection[],
): EvidenceCaveat[] {
  const caveats = new Set<EvidenceCaveat>();
  if (
    collections.some(collection =>
      collection.batch.coverage.some(item => item.gaps.length > 0),
    )
  )
    caveats.add('incomplete_coverage');
  if (
    collections.some(collection =>
      collection.batch.coverage.some(item => item.truncated),
    )
  )
    caveats.add('truncated_results');
  if (collections.some(collection => collection.batch.conflicts.length > 0))
    caveats.add('conflicting_records');
  if (
    collections.some(
      collection => collection.memoryStatus === 'local_memory_unavailable',
    )
  )
    caveats.add('reviewed_memory_unavailable');
  else if (
    collections.length > 0 &&
    collections.every(
      collection => collection.memoryStatus === 'no_matching_current_memory',
    )
  ) {
    caveats.add('no_matching_reviewed_memory');
  }
  return [...caveats];
}

function revalidateSource(context: ReadyContext) {
  return async (reference: VisitQuestionEvidenceItem, signal: AbortSignal) =>
    !signal.aborted && (await context.revalidateEvidence([reference]));
}

function sameAppointment(context: ReadyContext, appointment: Appointment) {
  return (
    context.appointment.id === appointment.id &&
    localEvidenceFingerprint(context.appointment) ===
      localEvidenceFingerprint(appointment)
  );
}

async function loadAppointment(now: string): Promise<Appointment | null> {
  // Delay native SQLCipher imports until the route actually reads local records.
  const { openLocalRecordQueryService } =
    await import('../../agent/localRecordQuery');
  const service = await openLocalRecordQueryService();
  const result = await service.queryNextConfirmedCalendarAppointment(now);
  if (result.status === 'no_confirmed_upcoming_calendar_appointment')
    return null;
  if (!result.appointment) return null;
  const appointment = AppointmentSchema.safeParse(result.appointment);
  if (!appointment.success) throw new Error('The next appointment is invalid.');
  return appointment.data;
}

async function generate(
  input: VisitQuestionRouteGenerationInput,
): Promise<VisitQuestionRouteGeneration> {
  const { prepareUpcomingVisitQuestionContext } =
    await import('../../agent/visitQuestions/localContext');
  const now = new Date().toISOString();
  const context = await prepareUpcomingVisitQuestionContext({
    now,
    maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems - 3,
  });
  if (context.status !== 'ready') {
    return {
      status: 'unavailable',
      message: copy.appointment.none,
    };
  }
  if (!sameAppointment(context, input.appointment)) {
    return {
      status: 'refresh_required',
      message: copy.generation.refreshRequired,
    };
  }

  const collections = [context.evidence];
  const workflowContext: ReadyContext = {
    ...context,
    async searchEvidence(query, maxEvidenceItems, sourceKind, signal) {
      const result = await context.searchEvidence(
        query,
        maxEvidenceItems,
        sourceKind,
        signal,
      );
      if (sourceKind !== 'personal_record') collections.push(result);
      return result;
    },
  };
  const result = await runVisitQuestionWorkflow({
    prepared: workflowContext,
    selection: input.selectedAi.selection as ProviderSelection,
    providerOptions: [input.selectedAi.option],
    recipient: input.selectedAi.recipient,
    // Selection does not imply consent; #30 authorizes this exact outbound request before inference.
    confirmConsent: input.confirmConsent,
    signal: input.signal,
  });
  const caveats = currentEvidenceCaveats(collections);
  if (result.status === 'ready') {
    return {
      status: 'ready',
      questions: result.questions,
      caveats,
      validateSource: revalidateSource(context),
    };
  }
  if (result.status === 'provider_selection_required') {
    return {
      status: 'provider_unavailable',
      message: copy.generation.providerUnavailable,
      caveats,
    };
  }
  if (result.status === 'provider_unavailable') {
    return { status: 'provider_unavailable', message: result.message, caveats };
  }
  if (result.status === 'needs_clarification') {
    return {
      status: 'needs_clarification',
      message: result.message,
      caveats: [...caveats, 'insufficient_evidence'],
    };
  }
  if (result.status === 'consent_required') {
    return { status: 'consent_required', message: result.message, caveats };
  }
  if (result.status === 'cancelled') return { status: 'cancelled' };
  return { status: result.status, message: result.message, caveats };
}

export const defaultVisitQuestionRouteOperations: VisitQuestionRouteOperations =
  {
    loadAppointment,
    generate,
    save: saveVisitQuestionRoute,
  };

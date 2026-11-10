import { DEFAULT_MULTI_AGENT_BUDGET } from '@orot/agent-runtime';
import type { OutboundProcessingRequest } from '@orot/agent-runtime';
import type { AiWorkflowObserver } from '../../agent/workflowActivity';
import type { Appointment } from '@orot/domain';
import { localEvidenceFingerprint } from '../../agent/visitQuestions/evidence';
import { runVisitQuestionWorkflow } from '../../agent/visitQuestions/workflow';
import type { VisitQuestionEvidenceItem } from '../../agent/visitQuestions/taskContract';
import type { ProviderSelection } from '../../providers/selection/types';
import type { SelectedAiResolution } from './provider';
import { nextVisitQuestionsCopy as copy } from '../../nextVisitQuestions/copy';
import type { GenerationOutcome } from '../../nextVisitQuestions/types';
import { saveVisitQuestionRoute } from './visitQuestionsRouteSave';
import { loadVisitQuestionsContext } from './visitQuestionsContextLoader';
import { visitQuestionPublicSearch } from './visitQuestionPublicSearch';
import { loadVisitQuestionAppointment } from './visitQuestionAppointment';
import {
  currentEvidenceCaveats,
  type EvidenceCoverageState,
} from './visitEvidenceCaveats';
import type {
  VisitQuestionRouteSaveInput,
  VisitQuestionRouteSaveResult,
} from './visitQuestionsRouteSave';
import type { AiFeatureServices } from './featureServices';

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
  readonly generatedArtifactTools?: AiFeatureServices['generatedArtifactTools'];
  readonly appointment: Appointment;
  readonly request?: string;
  readonly selectedAi: ReadySelection;
  readonly confirmConsent: (
    request: OutboundProcessingRequest,
  ) => Promise<boolean>;
  readonly signal: AbortSignal;
  readonly observer?: AiWorkflowObserver;
  readonly registerToolSource?: AiFeatureServices['registerVisitQuestionSource'];
}

export interface VisitQuestionRouteOperations {
  loadAppointment(
    now: string,
    appointmentId?: string,
  ): Promise<Appointment | null>;
  generate(
    input: VisitQuestionRouteGenerationInput,
  ): Promise<VisitQuestionRouteGeneration>;
  save(
    input: VisitQuestionRouteSaveInput,
  ): Promise<VisitQuestionRouteSaveResult>;
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

async function generate(
  input: VisitQuestionRouteGenerationInput,
): Promise<VisitQuestionRouteGeneration> {
  if (input.signal.aborted) return { status: 'cancelled' };
  const { prepareUpcomingVisitQuestionContext } =
    await loadVisitQuestionsContext();
  if (input.signal.aborted) return { status: 'cancelled' };
  const now = new Date().toISOString();
  const context = await prepareUpcomingVisitQuestionContext({
    now,
    appointmentId: input.appointment.id,
    signal: input.signal,
    maxEvidenceItems: DEFAULT_MULTI_AGENT_BUDGET.maxEvidenceItems - 3,
  });
  if (input.signal.aborted || context.status === 'cancelled')
    return { status: 'cancelled' };
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

  const publicSearch = await visitQuestionPublicSearch({
    selected: input.selectedAi,
    confirm: input.confirmConsent,
    query: context.query,
    signal: input.signal,
  });
  if (publicSearch.result.status === 'cancelled')
    return { status: 'cancelled' };

  const collections: EvidenceCoverageState[] = [context.evidence];
  const generated = await input.generatedArtifactTools?.();
  if (input.signal.aborted) return { status: 'cancelled' };
  const periodTool = context.healthContextTool;
  const workflowContext: ReadyContext = {
    ...context,
    async revalidateEvidence(references) {
      const artifactReferences = references.filter(reference =>
        generated?.owns(reference),
      );
      const localReferences = references.filter(
        reference => !generated?.owns(reference),
      );
      // The generation signal is aborted on completion; later source opening needs a fresh validation signal.
      return (
        (!artifactReferences.length ||
          Boolean(
            generated &&
            (await generated.validate(
              artifactReferences,
              new AbortController().signal,
            )),
          )) &&
        (!localReferences.length ||
          (await context.revalidateEvidence(localReferences)))
      );
    },
    ...(periodTool
      ? {
          healthContextTool: {
            ...periodTool,
            async search(request) {
              const batch = await periodTool.search(request);
              // Real period limits are coverage gaps, unlike an ordinary top-k raw-record selection.
              if (!('status' in batch))
                collections.push({ batch, memoryStatus: 'not_searched' });
              return batch;
            },
          },
        }
      : {}),
    async searchEvidence(query, maxEvidenceItems, sourceKind, signal) {
      const result = await context.searchEvidence(
        query,
        maxEvidenceItems,
        sourceKind,
        signal,
      );
      // Personal-search gaps and conflicts must reach the review beside its questions.
      collections.push(result);
      return result;
    },
  };
  const result = await runVisitQuestionWorkflow({
    prepared: workflowContext,
    ...(input.request !== undefined ? { request: input.request } : {}),
    generatedTools: generated?.tools,
    selection: input.selectedAi.selection as ProviderSelection,
    providerOptions: [input.selectedAi.option],
    recipient: input.selectedAi.recipient,
    // Selection does not imply permission to transmit the resulting health context.
    confirmConsent: input.confirmConsent,
    reservedPublicSearchCall: publicSearch.spentModelCall,
    signal: input.signal,
    ...(input.observer ? { observer: input.observer } : {}),
    ...(input.registerToolSource
      ? { registerToolSource: input.registerToolSource }
      : {}),
  });
  const caveats = [
    ...currentEvidenceCaveats(collections),
    ...(publicSearch.caveat ? [publicSearch.caveat] : []),
  ];
  if (input.signal.aborted) return { status: 'cancelled' };
  if (result.status === 'ready') {
    return {
      status: 'ready',
      questions: result.questions,
      caveats,
      validateSource: revalidateSource(workflowContext),
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
    loadAppointment: loadVisitQuestionAppointment,
    generate,
    save: saveVisitQuestionRoute,
  };

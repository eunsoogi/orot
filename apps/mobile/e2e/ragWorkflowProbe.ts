import { RAG_CONVERSATION_BUDGET } from '../src/ragConversation/budget';
import type { LanguageModelProvider } from '@orot/model-runtime';
import { AppleFoundationModelsProvider } from '@orot/provider-apple';
import { appleFoundationModelsProbeBridge as appleFoundationModelsNativeBridge } from './appleModelMockBridge';
import { createEuropePmcMedicalEvidenceService } from '../src/externalMedicalEvidence/europePmc';
import type { ExternalMedicalPublication } from '../src/externalMedicalEvidence/europePmc';
import { createExternalConversationEvidence } from '../src/aiFeatures/integration/externalConversationEvidence';
import { runRagConversationTurn } from '../src/ragConversation/service';
import type { RagConversationOutcome } from '../src/ragConversation/service';
import { RAG_WORKFLOW_PUBLIC_QUERY } from './appleModelMockFixtures';

const question = `This is a synthetic general-literature question, with no personal health records. Search Europe PMC using the exact query "${RAG_WORKFLOW_PUBLIC_QUERY}". Summarize what the returned publications say about adult sleep duration, cite their supplied evidence IDs and publication dates, and explain the limits of this search sample. Do not give individual medical advice.`;

export interface RagWorkflowProbeResult {
  readonly availability: string;
  readonly terminal: string;
  readonly retrieval: 'observed' | 'notobserved';
  readonly consent: readonly { query: string; decision: string }[];
  readonly requests: readonly string[];
  readonly responses: readonly { status: number; ok: boolean }[];
  readonly publications: readonly ExternalMedicalPublication[];
  readonly diagnostics: readonly unknown[];
  readonly sessionCancellations: readonly string[];
  readonly outcome?: RagConversationOutcome;
  readonly failure?: string;
  readonly elapsedMs: number;
  /** null records the shipping profile's absence of an automatic elapsed deadline. */
  readonly workflowBudgetMs: number | null;
  readonly parentAborted: boolean;
}

/** Executes the shipping RAG chain with real network calls and the native model bridge and an empty personal library. */
export async function runRagWorkflowProbe(
  onPhase: (phase: string) => void,
  parentSignal: AbortSignal,
): Promise<RagWorkflowProbeResult> {
  const startedAt = Date.now();
  const controller = new AbortController();
  const abort = () => controller.abort();
  parentSignal.addEventListener('abort', abort, { once: true });
  if (parentSignal.aborted) abort();
  const consent: { query: string; decision: string }[] = [];
  const requests: string[] = [];
  const responses: { status: number; ok: boolean }[] = [];
  const publications: ExternalMedicalPublication[] = [];
  const diagnostics: unknown[] = [];
  const sessionCancellations: string[] = [];
  let availability = 'notobserved';
  let terminal = 'notobserved';
  let outcome: RagConversationOutcome | undefined;
  let failure: string | undefined;
  const modelProvider = new AppleFoundationModelsProvider({
    ...appleFoundationModelsNativeBridge,
    cancel(requestId) {
      sessionCancellations.push(requestId);
      appleFoundationModelsNativeBridge.cancel(requestId);
    },
  });
  const provider: LanguageModelProvider = {
    kind: modelProvider.kind,
    id: modelProvider.id,
    displayName: modelProvider.displayName,
    capabilities: modelProvider.capabilities,
    async generate(request, options) {
      onPhase('apple-generation');
      const callStarted = Date.now();
      const diagnostic: Record<string, unknown> = {
        startedAtMs: callStarted - startedAt,
        format: request.responseFormat?.name,
        requestCharacters: JSON.stringify(request).length,
        status: 'pending',
        aborted: false,
      };
      diagnostics.push(diagnostic);
      const markAborted = () => {
        diagnostic.aborted = true;
        diagnostic.elapsedMs = Date.now() - callStarted;
      };
      options?.signal?.addEventListener('abort', markAborted, { once: true });
      try {
        const result = await modelProvider.generate(request, options);
        diagnostic.status = result.ok ? 'response' : 'provider-error';
        diagnostic.response = result;
        return result;
      } catch (error) {
        diagnostic.status = 'thrown';
        diagnostic.error =
          error instanceof Error ? error.message : String(error);
        throw error;
      } finally {
        diagnostic.elapsedMs = Date.now() - callStarted;
        options?.signal?.removeEventListener('abort', markAborted);
      }
    },
  };
  const service = createEuropePmcMedicalEvidenceService({
    async fetcher(url, init) {
      onPhase('europe-pmc-request');
      requests.push(url);
      const response = await fetch(url, init);
      responses.push({ status: response.status, ok: response.ok });
      return response;
    },
  });
  const external = createExternalConversationEvidence(
    {
      async search(query, options) {
        const result = await service.search(query, options);
        if (result.status === 'available')
          publications.push(...result.publications);
        return result;
      },
    },
    {
      async authorize(request) {
        // This diagnostic authorizes exactly one public synthetic phrase, never model-expanded queries.
        const decision =
          request.query === RAG_WORKFLOW_PUBLIC_QUERY && !request.signal.aborted
            ? 'authorized'
            : 'denied';
        consent.push({ query: request.query, decision });
        return decision;
      },
    },
  );
  try {
    // The shipping workflow keeps its budget; only actual completion, errors or owner cancellation settle this probe.
    onPhase('apple-availability');
    availability = (await modelProvider.getAvailability()).status;
    if (availability !== 'available' || controller.signal.aborted) {
      terminal = controller.signal.aborted
        ? 'cancelled'
        : 'provider-unavailable';
    } else {
      outcome = await runRagConversationTurn(
        {
          question,
          previousMessages: [],
          loadCurrentEvidence: async () => ({
            batch: { items: [], coverage: [], conflicts: [] },
            chunks: [],
          }),
          // No chunks exist: reaching local retrieval would violate the diagnostic's empty-library boundary.
          rag: {
            search: async () => {
              throw new Error('Unexpected personal-record retrieval');
            },
          },
          workflow: {
            provider,
            execution: {
              operationRunId: 'synthetic-europe-pmc-' + Date.now(),
              providerId: provider.id,
              modelId: 'apple-foundation-models-system-default',
              recipient: 'on-device',
              remoteProcessing: false,
              allowedScope: {
                sourceKinds: ['external_medical'],
                sourceIds: ['europe-pmc'],
              },
              budget: RAG_CONVERSATION_BUDGET,
            },
            tools: [external.tool],
            consent: {
              authorize: async () =>
                controller.signal.aborted ? 'renewal_required' : 'authorized',
            },
            revalidateEvidence: async (references, signal) =>
              !signal.aborted &&
              references.every(reference => external.validates(reference)),
          },
        },
        { signal: controller.signal },
      );
      terminal = controller.signal.aborted ? 'cancelled' : outcome.status;
    }
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    terminal = controller.signal.aborted ? 'cancelled' : 'probe-error';
  } finally {
    parentSignal.removeEventListener('abort', abort);
  }
  onPhase(terminal);
  return {
    availability,
    terminal,
    retrieval: requests.length ? 'observed' : 'notobserved',
    consent: [...consent],
    requests: [...requests],
    responses: [...responses],
    publications: [...publications],
    diagnostics: [...diagnostics],
    sessionCancellations: [...sessionCancellations],
    outcome,
    failure,
    elapsedMs: Date.now() - startedAt,
    workflowBudgetMs: RAG_CONVERSATION_BUDGET.timeoutMs,
    parentAborted: controller.signal.aborted,
  };
}

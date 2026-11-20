import { NativeModules } from 'react-native';
import { providerDiagnostic } from '../../providers/diagnostics';
import type { Stage } from '../../providers/diagnosticTypes';
import type { ConversationEntryContext } from './conversationIntent';
import type { RagConversationMessage } from '../../ragConversation/task';
import type { RagConversationOutcome } from '../../ragConversation/service';
import type { LanguageModelProvider } from '@orot/model-runtime';
import type { MultiAgentBudget } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import type { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import type { DefaultPublicSearchResult } from './defaultPublicSearch';
import { budgetAfterPublicSearch } from './defaultPublicSearch';
import { guardHistory } from './conversationHistoryProviderGuard';
import { conversationStreamObservers } from './conversationStreamObservers';
import type { RagConversationRunOptions } from '../../ragConversation/service';
import type { loadConversationHistory } from './conversationHistorySources';
import type { createConversationRetentionBridge } from './conversationRetentionBridge';
import { emptyConversationSnapshot } from './conversationEntryTargets';

/** Preserve source fences and the actual preflight budget for this invocation. */
export function conversationRunWorkflow<
  T extends {
    provider: LanguageModelProvider;
    execution: { budget: MultiAgentBudget };
  },
>(
  execution: T,
  current: () => Promise<boolean>,
  hasHistory: boolean,
  search: DefaultPublicSearchResult,
  searchedTool: boolean,
) {
  return {
    ...guardHistory(execution, current, hasHistory),
    execution: {
      ...execution.execution,
      budget: budgetAfterPublicSearch(
        execution.execution.budget,
        search,
        searchedTool,
      ),
    },
  };
}

/** Preview suppression does not suppress the caller's source-fence callbacks. */
export function conversationRunInvocation(
  observer: RagConversationObserver | undefined,
  retained: boolean,
  registry: LocalEvidenceReferenceRegistry,
  selection: { providerId: string; modelId: string },
  signal: AbortSignal,
) {
  return {
    onApprovalWait: observer?.onApprovalWait,
    onProgress: observer?.onProgress,
    onToolEvent: observer?.onToolEvent,
    ...conversationStreamObservers(observer, retained, registry, selection),
    signal,
  };
}

/** Keep history and selected evidence lineage attached to the responder input. */
export function conversationRunRequest(input: {
  readonly continuation?: RagConversationRunOptions['continuation'];
  readonly onInitialSearchStatus?: RagConversationRunOptions['onInitialSearchStatus'];
  readonly question: string;
  readonly photoEvidence?: RagConversationRunOptions['photoEvidence'];
  readonly entryIntent?: RagConversationRunOptions['entryIntent'];
  readonly targetVisitEvidence?: RagConversationRunOptions['targetVisitEvidence'];
  readonly dailyReportEvidence?: RagConversationRunOptions['dailyReportEvidence'];
  readonly history: Awaited<ReturnType<typeof loadConversationHistory>>;
  readonly retention: ReturnType<typeof createConversationRetentionBridge>;
  readonly rag: RagConversationRunOptions['rag'];
  readonly search: DefaultPublicSearchResult;
  readonly registry: LocalEvidenceReferenceRegistry;
  readonly workflow: RagConversationRunOptions['workflow'];
}): RagConversationRunOptions {
  return {
    continuation: input.continuation,
    onInitialSearchStatus: input.onInitialSearchStatus,
    question: input.question,
    ...(input.photoEvidence ? { photoEvidence: input.photoEvidence } : {}),
    entryIntent: input.entryIntent,
    targetVisitEvidence: input.targetVisitEvidence,
    dailyReportEvidence: input.dailyReportEvidence,
    previousMessages: input.history.messages,
    validatedPriorTurns: input.history.priorTurns,
    priorDialogueOmitted: input.history.omitted,
    onValidatedEvidence: references =>
      input.retention.onValidatedEvidence([
        ...references,
        ...input.history.sources,
        ...(input.dailyReportEvidence ?? []),
      ]),
    loadCurrentEvidence: emptyConversationSnapshot,
    rag: input.rag,
    ...(input.search.status === 'success'
      ? { publicEvidence: input.search.batch }
      : {}),
    resolveLocalEvidenceIdentity: reference =>
      input.registry.resolve(reference),
    readHistoricalArtifact: (reference, signal) =>
      input.registry.readSource(reference, signal),
    workflow: input.workflow,
  };
}

export const cancelled = { status: 'failure', kind: 'cancelled' } as const;

type RagSend = (
  question: string,
  previous: readonly RagConversationMessage[],
  signal?: AbortSignal,
  observer?: RagConversationObserver,
  entry?: ConversationEntryContext,
) => Promise<RagConversationOutcome>;

function receiptDiagnosticsEnabled() {
  try {
    return NativeModules.OrotProviderDiagnostics?.enabled === true;
  } catch {
    return false;
  }
}

type ReceiptStage = Extract<Stage, `conversation_receipt_${string}`>;

/** Native timestamps on fixed stage labels are for isolated, opt-in attempts.
 * No turn identifiers, payloads, or provider content enter the log. A
 * response-start marker precedes callback forwarding; it is not a UI receipt
 * or proof of a second provider start after an opening. */
function observeReceiptStage(
  stage: ReceiptStage,
  outcome: 'started' | 'completed' | 'failed',
) {
  try {
    providerDiagnostic('rag', stage, outcome);
  } catch {
    // Diagnostics cannot change a send, consent decision, or receipt.
  }
}

export function observeConversationReceiptTiming(send: RagSend): RagSend {
  if (!receiptDiagnosticsEnabled()) return send;
  return async (question, previous, signal, observer, entry) => {
    const onProviderReceipt = observer?.onProviderReceipt;
    observeReceiptStage('conversation_receipt_attempt', 'started');
    try {
      return await send(
        question,
        previous,
        signal,
        onProviderReceipt
          ? {
              ...observer,
              onProviderReceipt(receipt) {
                observeReceiptStage(
                  receipt === 'accepted'
                    ? 'conversation_receipt_accepted'
                    : 'conversation_receipt_response_started',
                  'completed',
                );
                onProviderReceipt(receipt);
              },
            }
          : observer,
        entry,
      );
    } finally {
      // Completed means the attempt settled, even on decline, Stop, or failure.
      observeReceiptStage('conversation_receipt_attempt', 'completed');
    }
  };
}

/** The final runner excludes opening generation and review, which already
 * emit their own independently gated spans. A runner return is not a receipt. */
export function observeConversationMain(
  run: typeof import('../../ragConversation/service').runRagConversationTurn,
): typeof run {
  if (!receiptDiagnosticsEnabled()) return run;
  return async (options, invocation) => {
    observeReceiptStage('conversation_receipt_main', 'started');
    try {
      const outcome = await run(options, invocation);
      observeReceiptStage('conversation_receipt_main', 'completed');
      return outcome;
    } catch (error) {
      observeReceiptStage('conversation_receipt_main', 'failed');
      throw error;
    }
  };
}

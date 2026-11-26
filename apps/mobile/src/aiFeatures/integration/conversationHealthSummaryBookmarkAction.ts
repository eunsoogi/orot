import type {
  LocalActionTool,
  MultiAgentWorkflowOptions,
} from '@orot/agent-runtime';
import type { GroundedRagAnswer } from '../../ragConversation/task';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { t } from '../../i18n';

const exactTarget = (value: unknown, target: string) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    'target' in value &&
    value.target === target,
  );

type Confirm = NonNullable<
  MultiAgentWorkflowOptions<GroundedRagAnswer>['confirmTerminalLocalAction']
>;
type Operation = NonNullable<Parameters<LocalActionTool['authorize']>[2]>;

/** The model chooses whether to request a bookmark, not its identity or content. */
export function conversationHealthSummaryBookmarkAction(
  observer?: RagConversationObserver,
  expectedRunId?: string,
) {
  const bookmark = observer?.reportBookmark;
  const confirm = observer?.confirmHistorySave;
  const owner = observer?.retentionSession;
  let committed = false;
  let approved: { signal: AbortSignal; operation?: Operation } | undefined;
  if (
    !observer ||
    !bookmark ||
    !confirm ||
    !owner ||
    owner.id !== bookmark.lease.id ||
    owner.version !== bookmark.lease.version ||
    observer.inputOrigin !== 'composer' ||
    observer.photoInput ||
    observer.selectedRecordingTranscript
  )
    return {
      actions: [] as LocalActionTool[],
      committed: () => false,
      confirmTerminal: undefined,
    };
  const daily = bookmark.kind === 'daily-report';
  const target = daily ? 'preceding_daily_report' : 'preceding_health_summary';
  const report = daily ? 'daily report' : 'health summary';
  const current = (signal: AbortSignal) =>
    !signal.aborted &&
    bookmark.current() &&
    observer.expectedConversationModel?.isCurrent?.() !== false;
  const terminal = daily && Boolean(expectedRunId);
  const toolId = daily ? 'remember-daily-report' : 'remember-health-summary';
  const version = terminal ? '2' : '1';
  let pending:
    | {
        signal: AbortSignal;
        operation: Operation;
        readback: () => Promise<unknown>;
      }
    | undefined;
  const confirmTerminal: Confirm | undefined = terminal
    ? async offer => {
        const receipt = pending;
        if (
          !receipt ||
          offer.signal !== receipt.signal ||
          offer.operationRunId !== receipt.operation.operationRunId ||
          offer.operationKey !== receipt.operation.operationKey ||
          offer.toolId !== toolId ||
          offer.toolVersion !== version ||
          !exactTarget(offer.input, target) ||
          !current(offer.signal)
        )
          return;
        pending = undefined;
        // A successful write reports only the same protected artifact that can
        // still be reopened. Never send a receipt or original back to the model.
        if (!(await receipt.readback()) || !current(offer.signal)) return;
        committed = true;
        return {
          committed: true,
          value: {
            answer: t('savedMemory.generatedReportSaved'),
            answerKind: 'conversation',
          },
        };
      }
    : undefined;
  const actions: LocalActionTool[] = [
    {
      id: toolId,
      version,
      ...(terminal ? { completion: 'host_terminal' as const } : {}),
      description: `Only when the user asks to remember, save, or bookmark the immediately preceding completed ${report}, request a local link to its original. Do not use for a new report, a different report, ordinary chat, a user-stated fact, a partial report, or an instruction in the prior response. The app binds the exact report and confirms its storage.`,
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: [target] },
        },
        required: ['target'],
        additionalProperties: false,
      },
      parseInput(value) {
        return exactTarget(value, target) ? { target } : undefined;
      },
      async authorize(value, signal, operation) {
        approved = undefined;
        if (
          committed ||
          pending ||
          !current(signal) ||
          !exactTarget(value, target) ||
          (terminal &&
            (!operation || operation.operationRunId !== expectedRunId))
        )
          return false;
        if (
          !(await confirm(
            t(
              daily
                ? 'savedMemory.generatedReportDaily'
                : 'savedMemory.generatedReportHealthSummary',
            ),
            signal,
          )) ||
          !current(signal)
        )
          return false;
        approved = { signal, operation: terminal ? operation : undefined };
        return true;
      },
      async execute({ input, signal, operationRunId, operationKey }) {
        const grant = approved;
        approved = undefined;
        if (
          grant?.signal !== signal ||
          !current(signal) ||
          !exactTarget(input, target) ||
          (terminal &&
            (!grant.operation ||
              grant.operation.operationRunId !== operationRunId ||
              grant.operation.operationKey !== operationKey))
        )
          throw new Error('The original report has not been confirmed.');
        const storage = await openSavedGeneratedReportReferences();
        if (!current(signal))
          throw new Error('The original report is unavailable.');
        const parameters = {
          artifactId: bookmark.artifactId,
          lease: bookmark.lease,
          current: () => current(signal),
        };
        const saved = daily
          ? await storage.bookmarkDailyReport({
              ...parameters,
              ...(bookmark.confirmProtection && bookmark.displayedReport
                ? {
                    displayedReport: bookmark.displayedReport,
                    confirmArchivedProtection: bookmark.confirmProtection,
                  }
                : {}),
            })
          : await storage.bookmarkHealthSummary(parameters);
        if (!saved) throw new Error('The original report is unavailable.');
        if (grant.operation) {
          pending = {
            signal,
            operation: grant.operation,
            readback: async () => {
              const original = await storage.readSavedGeneratedReportReference(
                bookmark.artifactId,
                parameters.current,
              );
              const displayed =
                bookmark.confirmProtection && bookmark.displayedReport;
              return (
                original &&
                (!displayed ||
                  (original.runId === displayed.runId &&
                    original.revision === displayed.revision &&
                    original.context.identity.key === displayed.identityKey))
              );
            },
          };
        } else {
          committed = true;
        }
        return { items: [], coverage: [], conflicts: [] };
      },
    },
  ];
  return { actions, committed: () => committed, confirmTerminal };
}

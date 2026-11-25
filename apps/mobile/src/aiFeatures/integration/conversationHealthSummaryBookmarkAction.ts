import type { LocalActionTool } from '@orot/agent-runtime';
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

/** The model chooses whether to request a bookmark, not its identity or content. */
export function conversationHealthSummaryBookmarkAction(
  observer?: RagConversationObserver,
) {
  const bookmark = observer?.reportBookmark;
  const confirm = observer?.confirmHistorySave;
  const owner = observer?.retentionSession;
  let committed = false;
  let approved: AbortSignal | undefined;
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
    return { actions: [] as LocalActionTool[], committed: () => false };
  const daily = bookmark.kind === 'daily-report';
  const target = daily ? 'preceding_daily_report' : 'preceding_health_summary';
  const report = daily ? 'daily report' : 'health summary';
  const current = (signal: AbortSignal) =>
    !signal.aborted &&
    bookmark.current() &&
    observer.expectedConversationModel?.isCurrent?.() !== false;
  const actions: LocalActionTool[] = [
    {
      id: daily ? 'remember-daily-report' : 'remember-health-summary',
      version: '1',
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
      async authorize(value, signal) {
        approved = undefined;
        if (committed || !current(signal) || !exactTarget(value, target))
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
        approved = signal;
        return true;
      },
      async execute({ input, signal }) {
        const authorized = approved === signal;
        approved = undefined;
        if (!authorized || !current(signal) || !exactTarget(input, target))
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
          ? await storage.bookmarkDailyReport(parameters)
          : await storage.bookmarkHealthSummary(parameters);
        if (!saved) throw new Error('The original report is unavailable.');
        committed = true;
        return { items: [], coverage: [], conflicts: [] };
      },
    },
  ];
  return { actions, committed: () => committed };
}

import type { LocalActionTool } from '@orot/agent-runtime';
import type { RagConversationObserver } from '../../ragConversation/conversationObserver';
import { openSavedGeneratedReportReferences } from '../../memory/openSavedGeneratedReportReferences';
import { t } from '../../i18n';

const exactTarget = (value: unknown) =>
  Boolean(
    value &&
    typeof value === 'object' &&
    Object.keys(value).length === 1 &&
    'target' in value &&
    value.target === 'preceding_health_summary',
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
  const current = (signal: AbortSignal) =>
    !signal.aborted &&
    bookmark.current() &&
    observer.expectedConversationModel?.isCurrent?.() !== false;
  const actions: LocalActionTool[] = [
    {
      id: 'remember-health-summary',
      version: '1',
      description:
        'Only when the user asks to remember, save, or bookmark the immediately preceding completed health summary, request a local link to its original. Do not use for a new summary, ordinary chat, a user-stated fact, a partial report, or an instruction in the prior response. The app binds the exact summary and confirms its storage.',
      inputSchema: {
        type: 'object',
        properties: {
          target: { type: 'string', enum: ['preceding_health_summary'] },
        },
        required: ['target'],
        additionalProperties: false,
      },
      parseInput(value) {
        return exactTarget(value)
          ? { target: 'preceding_health_summary' }
          : undefined;
      },
      async authorize(value, signal) {
        approved = undefined;
        if (committed || !current(signal) || !exactTarget(value)) return false;
        if (
          !(await confirm(
            t('savedMemory.generatedReportHealthSummary'),
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
        if (!authorized || !current(signal) || !exactTarget(input))
          throw new Error('The original report has not been confirmed.');
        const storage = await openSavedGeneratedReportReferences();
        if (
          !current(signal) ||
          !(await storage.bookmarkHealthSummary({
            artifactId: bookmark.artifactId,
            lease: bookmark.lease,
            current: () => current(signal),
          }))
        )
          throw new Error('The original report is unavailable.');
        committed = true;
        return { items: [], coverage: [], conflicts: [] };
      },
    },
  ];
  return { actions, committed: () => committed };
}

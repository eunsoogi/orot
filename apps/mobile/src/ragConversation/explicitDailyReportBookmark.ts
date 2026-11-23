import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import { dispatchConversationMessage } from './conversationVisitDispatch';
import { Alert, AppState } from 'react-native';
import { t } from '../i18n';
import type { ConversationSessions } from './conversationSessions';
import { visibleSavedHistoryDisplay } from './conversationSavedHistoryDisplay';

type Owner = Readonly<{
  store: ConversationSessions;
  id: number;
  current?: () => boolean;
}>;
type Target = Readonly<{ artifactId: string; runId: string; date: string }>;

export function currentReportBookmarkOwner(owner: Owner) {
  const { sessions, activeId } = owner.store.getSnapshot();
  const session = sessions.find(row => row.id === owner.id);
  return AppState.currentState === 'active' &&
    (!owner.current || owner.current()) &&
    owner.id === activeId &&
    session &&
    !session.quarantined &&
    !session.restoring &&
    !session.modelSelectionPending &&
    !session.modelSelectionFailed &&
    !session.leaseRefreshRequired
    ? session
    : undefined;
}

function candidates(owner: Owner) {
  const session = currentReportBookmarkOwner(owner);
  const targets = new Map<string, Target>();
  if (!session) return [];
  for (const { row } of visibleSavedHistoryDisplay(session) ?? []) {
    if (row.kind === 'answer' && !row.partial && row.dailyReport)
      targets.set(row.dailyReport.runId, {
        artifactId: row.id,
        runId: row.dailyReport.runId,
        date: row.dailyReport.identity.localDate,
      });
  }
  for (const row of session.messages)
    if (
      row.role === 'assistant' &&
      row.dailyReport &&
      row.retainedTurnId &&
      !row.incomplete &&
      !row.streaming
    )
      targets.set(row.dailyReport.runId, {
        artifactId: row.retainedTurnId,
        runId: row.dailyReport.runId,
        date: row.dailyReport.identity.localDate,
      });
  return [...targets.values()];
}

/** Only an explicit, whole-message, local command is handled; never ask a model to find a bookmark. */
export function handleExplicitDailyReportBookmark(owner: Owner): boolean {
  const { store, id } = owner;
  const draftOwner = store.getSnapshot().sessions.find(row => row.id === id);
  if (!draftOwner) return false;
  const originalDraft = draftOwner.draft;
  if (
    !/^(?:(?:이|이 일일|지금 이)\s*보고서(?:를)?\s*(?:기억해(?:\s*줘)?|기억에\s*(?:저장|보관)해(?:\s*줘)?|저장해(?:\s*줘)?|보관해(?:\s*줘)?)|(?:please\s+)?(?:remember|save|bookmark)\s+this\s+(?:daily\s+)?report)[.!]?$/iu.test(
      originalDraft.trim(),
    )
  )
    return false;
  if (store.photoDrafts.get(id).status !== 'empty') return false;
  const session = currentReportBookmarkOwner(owner);
  if (!session || session.busy || session.preparingSend) return true;
  const lease = store.savedReportLease(id);
  const selected = candidates(owner);
  const notice = (
    kind: 'generatedReportSaved' | 'generatedReportUnavailable',
  ) =>
    Alert.alert(
      t(
        kind === 'generatedReportSaved'
          ? 'savedMemory.generatedReportSaved'
          : 'savedMemory.generatedReportUnavailable',
      ),
    );
  const save = async (target: Target) => {
    const current = () => {
      const active = currentReportBookmarkOwner(owner);
      const now = store.savedReportLease(id);
      return Boolean(
        lease &&
        now?.id === lease.id &&
        now.version === lease.version &&
        active &&
        !active.busy &&
        !active.preparingSend &&
        active.draft === originalDraft &&
        candidates(owner).some(
          row =>
            row.runId === target.runId && row.artifactId === target.artifactId,
        ),
      );
    };
    if (!lease || !current()) return;
    try {
      const bookmarks = await openSavedGeneratedReportReferences();
      const saved = await bookmarks.bookmarkDailyReport({
        artifactId: target.artifactId,
        lease,
        current,
      });
      if (!current()) return;
      if (saved) store.setDraft(id, '');
      notice(saved ? 'generatedReportSaved' : 'generatedReportUnavailable');
    } catch {
      if (current()) notice('generatedReportUnavailable');
    }
  };
  if (selected.length === 1 && selected[0]) save(selected[0]);
  else if (selected.length > 1)
    Alert.alert(
      t('savedMemory.generatedReportDaily'),
      t('savedMemory.pickGeneratedReport'),
      selected.length <= 4
        ? [
            ...selected.map(target => ({
              text: target.date,
              onPress: () => {
                save(target);
              },
            })),
            { text: t('savedMemory.close'), style: 'cancel' },
          ]
        : undefined,
    );
  else notice('generatedReportUnavailable');
  return true;
}

/** The regular composer retains its existing route and provider dispatch. */
export function composerSendWithReportBookmark(
  store: Parameters<typeof dispatchConversationMessage>[0],
  id: Parameters<typeof dispatchConversationMessage>[1],
  current: Owner['current'],
  send: Parameters<typeof dispatchConversationMessage>[2],
  prepare: Parameters<typeof dispatchConversationMessage>[3],
) {
  return () => {
    if (current && !current()) return;
    if (!handleExplicitDailyReportBookmark({ store, id, current }))
      dispatchConversationMessage(store, id, send, prepare, current);
  };
}

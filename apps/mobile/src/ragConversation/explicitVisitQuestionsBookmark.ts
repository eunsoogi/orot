import { Alert } from 'react-native';
import { t } from '../i18n';
import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationSession } from './conversationSessionTypes';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import {
  savedHistoryTranscript,
  visibleSavedHistoryDisplay,
} from './conversationSavedHistoryDisplay';
import { displayedVisitQuestionsBookmarkTarget } from './visitQuestionsBookmarkTarget';

type Owner = Readonly<{
  store: ConversationSessions;
  id: number;
  current?: ReportBookmarkVisibility;
}>;
const pending = new WeakMap<ConversationSessions, Set<number>>();

function visibleTail(session: ConversationSession) {
  const saved = visibleSavedHistoryDisplay(session);
  if (session.savedHistoryDisplay && !saved) return;
  return savedHistoryTranscript(saved ?? [], session.messages).at(-1);
}

/** One whole-message command is local to the composer. Cold marker-only rows
 * still require the existing protected preview and explicit Save button. */
export function handleExplicitVisitQuestionsBookmark(
  owner: Owner,
  currentSession: () => ConversationSession | undefined,
): boolean {
  const { store, id } = owner;
  const draft = store.getSnapshot().sessions.find(row => row.id === id)?.draft;
  if (
    !draft ||
    !/^(?:save these visit questions|이 진료 질문을 기억해\s*줘)[.!]?$/iu.test(
      draft.trim(),
    )
  )
    return false;
  const session = currentSession();
  if (!session || session.busy || session.preparingSend) return true;
  const notice = (kind: 'saved' | 'unavailable' | 'archived') =>
    Alert.alert(
      t(
        kind === 'saved'
          ? 'savedMemory.generatedReportSaved'
          : kind === 'archived'
            ? 'savedMemory.reviewArchivedVisitBookmark'
            : 'savedMemory.generatedReportUnavailable',
      ),
    );
  const tail = visibleTail(session);
  const artifactId = !tail?.savedHistoryDisplayOnly && tail?.retainedTurnId;
  const displayed = tail && displayedVisitQuestionsBookmarkTarget(tail);
  const lease = store.savedReportLease(id);
  if (store.photoDrafts.get(id).status !== 'empty') {
    notice('unavailable');
    return true;
  }
  if (!tail || !artifactId || !displayed || !lease) {
    notice(
      tail?.savedHistoryDisplayOnly && tail.archivedVisitBookmark
        ? 'archived'
        : 'unavailable',
    );
    return true;
  }
  const inFlight = pending.get(store) ?? new Set<number>();
  if (inFlight.has(id)) return true;
  inFlight.add(id);
  pending.set(store, inFlight);
  const capture = captureReportBookmarkOwner({
    store,
    sessionId: id,
    current: owner.current,
  });
  let retired = false;
  const current = () => {
    const now = currentSession();
    const latest = now && visibleTail(now);
    if (
      !now ||
      now.busy ||
      now.preparingSend ||
      store.photoDrafts.get(id).status !== 'empty' ||
      !capture.current() ||
      !latest ||
      latest.id !== tail.id ||
      latest.savedHistoryDisplayOnly ||
      latest.retainedTurnId !== artifactId ||
      displayedVisitQuestionsBookmarkTarget(latest) !== displayed
    )
      retired = true;
    // A replaced artifact cannot revive even if the same content reappears.
    return !retired;
  };
  const unsubscribe = store.subscribe(current);
  void (async () => {
    try {
      if (!current()) return;
      const storage = await openSavedGeneratedReportReferences();
      if (!current()) return;
      const saved = await storage.bookmarkVisitQuestions({
        artifactId,
        displayed,
        lease,
        current,
      });
      if (!current()) return;
      if (saved) store.setDraft(id, '');
      notice(saved ? 'saved' : 'unavailable');
    } catch {
      if (current()) notice('unavailable');
    } finally {
      unsubscribe();
      capture.close();
      inFlight.delete(id);
      if (!inFlight.size) pending.delete(store);
    }
  })();
  return true;
}

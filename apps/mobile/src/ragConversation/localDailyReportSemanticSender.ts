import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import { APPLE_PROVIDER_ID } from '@orot/provider-apple';
import { dispatchConversationMessage } from './conversationVisitDispatch';
import {
  semanticReportBookmarkSender,
  latestReportArtifact,
} from './semanticReportBookmarkSender';
import { conversationEntryForSession } from './useConversationEntryIntent';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';
import { explicitReportBookmarkCommand } from './explicitReportBookmarkCommand';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationScreenProps } from './ConversationScreenProps';

type Send = ConversationScreenProps['onSend'];
type Owner = Readonly<{
  store: ConversationSessions;
  id: number;
  current?: ReportBookmarkVisibility;
}>;

export function dispatchBoundReportComposer(
  store: ConversationSessions,
  id: number,
  current: Owner['current'],
  send: Send,
  prepare?: ConversationScreenProps['prepareVisitQuestions'],
) {
  const bound = semanticReportBookmarkSender(store, id, current, send);
  return dispatchConversationMessage(
    store,
    id,
    bound.send,
    prepare,
    current,
  ).finally(bound.close);
}

/** A narrow on-device exception to the existing no-transfer local command.
 * No UI or old report model stamp grants recipient or write authority. */
export function delegateLocalDailyReportCommand(
  { store, id, current }: Owner,
  send: Send,
  dispatch: (sender: Send) => Promise<void>,
  legacy: () => Promise<void> | undefined,
) {
  const active = store
    .getSnapshot()
    .sessions.find(session => session.id === id);
  const entry = conversationEntryForSession(store, id);
  const command = active && explicitReportBookmarkCommand(active.draft);
  const report =
    command && !command.namedDaily
      ? latestReportArtifact(store, id)
      : undefined;
  if (
    !active ||
    report?.kind !== 'daily-report' ||
    active.entryIntent ||
    active.dailyReport ||
    (entry &&
      (entry.intent !== 'conversation' ||
        entry.appointmentId ||
        entry.dailyReport ||
        entry.directDailyReportRequest)) ||
    typeof store.prepareLocalReportModel !== 'function'
  )
    return legacy();
  const matchesReport = (
    candidate?: Pick<
      import('./semanticReportBookmarkSender').BoundReportBookmark,
      'artifactId' | 'kind' | 'displayedReport'
    >,
  ) =>
    candidate?.artifactId === report.artifactId &&
    candidate.kind === 'daily-report' &&
    candidate.displayedReport?.runId === report.displayedReport.runId &&
    candidate.displayedReport.revision === report.displayedReport.revision &&
    candidate.displayedReport.identityKey ===
      report.displayedReport.identityKey;
  const draft = captureReportBookmarkOwner({ store, sessionId: id, current });
  if (!draft.current()) {
    draft.close();
    return legacy();
  }
  const controller = new AbortController();
  const native = watchSavedReportNativeProtection(controller.signal, () => {});
  return (async () => {
    try {
      const model = await store
        .prepareLocalReportModel(id, controller.signal)
        .catch(() => undefined);
      if (!draft.current()) return;
      if (model && (!(await native?.confirm()) || !draft.current())) return;
      const latest = latestReportArtifact(store, id);
      if (
        conversationEntryForSession(store, id) !== entry ||
        !matchesReport(latest)
      )
        return;
      if (!model?.current()) return legacy();
      if (!native?.current()) return;
      draft.close();
      // The binder now owns a durable request. A selection move after
      // admission retires this send and never retries the write by another route.
      return await dispatch(
        async (question, history, signal, observer, context) => {
          const owner = observer?.templateProposalOwner;
          const reportBookmark = observer?.reportBookmark;
          const exact = () =>
            Boolean(
              signal &&
              !signal.aborted &&
              native.current() &&
              model.current() &&
              observer?.inputOrigin === 'composer' &&
              !observer.photoInput &&
              !observer.selectedRecordingTranscript &&
              !observer.expectedVoiceSelection &&
              observer.retentionSession?.id === model.lease.id &&
              observer.retentionSession.version === model.lease.version &&
              reportBookmark &&
              matchesReport(reportBookmark) &&
              reportBookmark.current() &&
              owner?.providerId === APPLE_PROVIDER_ID &&
              owner.modelId === model.modelId &&
              observer.expectedConversationModel?.providerId ===
                owner.providerId &&
              observer.expectedConversationModel.modelId === owner.modelId &&
              owner.current(),
            );
          const recheck = async () => {
            try {
              return Boolean(
                signal && exact() && (await owner?.recheck(signal)) && exact(),
              );
            } catch {
              return false;
            }
          };
          if (!observer || !reportBookmark || !(await recheck()))
            return { status: 'failure', kind: 'cancelled' };
          return send(
            question,
            history,
            signal,
            {
              ...observer,
              reportBookmark: {
                ...reportBookmark,
                displayedReport: report.displayedReport,
                confirmProtection: async () =>
                  exact() && (await native.confirm()) && exact(),
              },
              protectedLocalInput: true,
              suppressContextualOpening: true,
              expectedConversationModel: {
                providerId: APPLE_PROVIDER_ID,
                modelId: model.modelId,
                isCurrent: exact,
                isDurablyCurrent: recheck,
              },
            },
            context,
          );
        },
      );
    } finally {
      draft.close();
      controller.abort();
      native?.dispose();
    }
  })();
}

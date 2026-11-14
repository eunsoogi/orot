import { Fragment } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationEntryContext } from '../aiFeatures/integration/conversationIntent';
import { todayIdentity } from '../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../i18n';
import { DailyReportConversationHeader } from './DailyReportConversationHeader';
import type { ConversationScreenProps } from './ConversationScreenProps';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessions';

type Report = NonNullable<ConversationEntryContext['dailyReport']>;
type Common = {
  store: ConversationSessions;
  session: ConversationSession;
  onOpenSource: (source: EvidenceReference) => void;
};

function reportActions(
  store: ConversationSessions,
  session: ConversationSession,
  cardId: string,
) {
  const { id } = session;
  const revision = session.taskCards?.find(
    card => card.id === cardId,
  )?.revision;
  return {
    select: (target: Report) => {
      store
        .saveTaskCard(id, cardId, {
          kind: 'daily_report',
          identity: target.identity,
          report: target,
        })
        .then(
          () => store.selectDailyReport(id, target),
          () =>
            store.setError(id, t('ragConversation.conversation.restoreFailed')),
        );
    },
    identity: (identity: Report['identity']) =>
      store.saveTaskCard(id, cardId, { kind: 'daily_report', identity }),
    result: async (target: Report) => {
      if (revision === undefined) return;
      try {
        await store.saveTaskCard(
          id,
          cardId,
          {
            kind: 'daily_report',
            identity: target.identity,
            report: target,
          },
          revision,
        );
      } catch {
        store.setError(id, t('ragConversation.conversation.restoreFailed'));
        throw new Error('Unable to retain the report task.');
      }
    },
  };
}

/** Explicit actions and task identities stay bound to the selected conversation. */
export function ConversationTaskHeader({
  store,
  session,
  selectedReport,
  routeKey,
  reportOwner,
  onOpenDailyReport,
  renderReportTask,
  renderSavedReport,
}: Common & {
  selectedReport?: Report;
  routeKey?: string;
  reportOwner: number | null;
  onOpenDailyReport?: () => void;
  renderReportTask?: ConversationScreenProps['renderReportTask'];
  renderSavedReport?: ConversationScreenProps['renderSavedReport'];
}) {
  const { id } = session;
  const report = reportActions(store, session, routeKey ?? 'daily-report');
  const routeCard = session.taskCards?.find(
    card => card.id === (routeKey ?? 'daily-report'),
  );
  const requestInOtherSession = () => {
    const identity = todayIdentity();
    if (!identity) {
      store.setError(id, t('dailyReport.entryError'));
      return;
    }
    store
      .saveTaskCard(id, 'daily-report', { kind: 'daily_report', identity })
      .catch(() =>
        store.setError(id, t('ragConversation.conversation.restoreFailed')),
      );
  };
  const hasStoredReport = Boolean(
    selectedReport &&
    session.taskCards?.some(
      card =>
        card.task.kind === 'daily_report' &&
        card.task.report?.identity.key === selectedReport.identity.key &&
        card.task.report?.runId === selectedReport.runId &&
        card.task.report?.revision === selectedReport.revision,
    ),
  );
  return (
    <>
      <DailyReportConversationHeader
        report={selectedReport}
        onRequest={
          renderReportTask
            ? reportOwner !== null && reportOwner !== id
              ? requestInOtherSession
              : undefined
            : onOpenDailyReport
        }
      />
      {renderReportTask && (reportOwner === null || reportOwner === id)
        ? renderReportTask(
            report.select,
            report.identity,
            report.result,
            routeCard?.task.kind === 'daily_report'
              ? routeCard.task.report
              : undefined,
            routeCard?.revision,
          )
        : selectedReport && renderSavedReport && !hasStoredReport
          ? renderSavedReport(selectedReport, target =>
              store.selectDailyReport(id, target),
            )
          : null}
    </>
  );
}

/** Reopened task cards reference the existing encrypted outputs, never copied health text. */
export function ConversationStoredTaskCards({
  store,
  session,
  routeKey,
  renderStoredReportTask,
}: Common & {
  routeKey?: string;
  durableSessionId: string | null;
  renderStoredReportTask?: ConversationScreenProps['renderStoredReportTask'];
}) {
  return (
    <>
      {session.taskCards
        ?.filter(card => card.id !== routeKey)
        .map(card => {
          if (card.task.kind === 'daily_report') {
            const actions = reportActions(store, session, card.id);
            return (
              <Fragment key={card.id}>
                {renderStoredReportTask?.(
                  card,
                  actions.select,
                  actions.identity,
                  actions.result,
                )}
              </Fragment>
            );
          }
          // Retain historical artifacts in storage without reopening the retired
          // treatment workflow or exposing new generation/follow-up actions.
          return null;
        })}
    </>
  );
}

// Legacy-only harness preserves safety/storage regression coverage after UI retirement.
import { Fragment } from 'react';
import type { EvidenceReference } from '@orot/agent-runtime';
import type { ConversationEntryContext } from '../../aiFeatures/integration/conversationIntent';
import { todayIdentity } from '../../aiFeatures/integration/dailyReportTodayIdentity';
import { t } from '../../i18n';
import { TreatmentConversationAction } from '../../treatmentContext/TreatmentConversationAction';
import type { SavedTreatmentChoice } from '../../treatmentContext/treatmentSavedLibrary';
import { DailyReportConversationHeader } from '../DailyReportConversationHeader';
import type { ConversationScreenProps } from '../ConversationScreenProps';
import type {
  ConversationSession,
  ConversationSessions,
} from '../conversationSessions';

type Report = NonNullable<ConversationEntryContext['dailyReport']>;
type Common = {
  store: ConversationSessions;
  session: ConversationSession;
  onOpenSource: (source: EvidenceReference) => void;
};

function treatmentActions(store: ConversationSessions, id: number) {
  return {
    onSavedItem: (item: SavedTreatmentChoice) => {
      store
        .saveTaskCard(id, `treatment:${item.id}`, {
          kind: 'treatment',
          artifactId: item.id,
        })
        .catch(() =>
          store.setError(id, t('ragConversation.conversation.restoreFailed')),
        );
    },
    onDeletedItem: (item: SavedTreatmentChoice) =>
      store.forgetTaskCard(id, `treatment:${item.id}`),
  };
}
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
  onOpenSource,
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
      <TreatmentConversationAction
        key={id}
        sessionId={id}
        ownership={store.treatment}
        onOpenSource={onOpenSource}
        {...treatmentActions(store, id)}
      />
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
  onOpenSource,
  routeKey,
  durableSessionId,
  renderStoredReportTask,
}: Common & {
  routeKey?: string;
  durableSessionId: string | null;
  renderStoredReportTask?: ConversationScreenProps['renderStoredReportTask'];
}) {
  const { id } = session;
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
          return durableSessionId ? (
            <TreatmentConversationAction
              key={card.id}
              sessionId={id}
              ownership={store.treatment}
              onOpenSource={onOpenSource}
              initialSaved={{
                id: card.task.artifactId,
                artifactRevision: card.task.artifactRevision,
                sessionId: durableSessionId,
                createdAt: card.createdAt,
              }}
              {...treatmentActions(store, id)}
            />
          ) : null;
        })}
    </>
  );
}

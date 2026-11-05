import type { DisplayMessage } from './ConversationMessage';
import { ManualVisitRecords } from './ManualVisitRecords';
import { conversationEntryForSession } from './useConversationEntryIntent';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationSession } from './conversationSessionTypes';
import { AppText as Text } from '../layout/AppText';
import { styles } from './ConversationScreen.styles';

/** Each restored panel follows an explicitly source-validated visit, never date inference. */
export function ManualVisitTargetPanels({
  store,
  sessionId,
  messages,
  session,
  compact,
  disclaimer,
}: {
  readonly store: ConversationSessions;
  readonly sessionId: number;
  readonly messages: readonly DisplayMessage[];
  readonly session: ConversationSession;
  readonly compact: boolean;
  readonly disclaimer: string;
}) {
  const targets = new Map<string, string>();
  const available =
    !session.restoring && !session.restoreFailed && !session.quarantined;
  const entryAppointment = conversationEntryForSession(
    store,
    sessionId,
  )?.appointmentId;
  if (available && entryAppointment) targets.set(entryAppointment, 'entry');
  for (const message of available ? messages : []) {
    const visit = message.visitQuestions;
    if (visit)
      targets.set(
        visit.appointment.id,
        JSON.stringify(visit.review.expectedSavedQuestions),
      );
  }
  return (
    <>
      {[...targets].map(([appointmentId, revision]) => (
        <ManualVisitRecords
          key={appointmentId + ':' + revision}
          appointmentId={appointmentId}
        />
      ))}
      {compact ? <Text style={styles.disclaimer}>{disclaimer}</Text> : null}
    </>
  );
}

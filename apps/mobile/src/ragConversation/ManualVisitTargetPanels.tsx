import type { DisplayMessage } from './ConversationMessage';
import { Fragment, useEffect, useState } from 'react';
import { ConversationSavedRecaps } from './ConversationSavedRecaps';
import { ManualVisitRecords } from './ManualVisitRecords';
import { conversationEntryForSession } from './useConversationEntryIntent';
import type { ConversationSessions } from './conversationSessions';
import type { ConversationSession } from './conversationSessionTypes';
import { AppText as Text } from '../layout/AppText';
import { styles } from './ConversationScreen.styles';
import { RetainedManualVisitTargets } from './RetainedManualVisitTargets';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServiceTypes';
import type { ManualVisitDrafts } from './useManualVisitDraft';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';

interface ManualVisitTargetPanelsProps {
  readonly store: ConversationSessions;
  readonly sessionId: number;
  readonly messages: readonly DisplayMessage[];
  readonly session: ConversationSession;
  readonly compact: boolean;
  readonly disclaimer: string;
  readonly discover?: AiFeatureServices['conversationArtifacts'];
  readonly durableSessionId?: string | null;
}

/** Scope drafts to this session while source revalidation remounts its visit panels. */
export function ManualVisitTargetPanels(props: ManualVisitTargetPanelsProps) {
  return <ManualVisitSessionPanels key={props.sessionId} {...props} />;
}

function ManualVisitSessionPanels({
  store,
  sessionId,
  messages,
  session,
  compact,
  disclaimer,
  discover,
  durableSessionId,
}: ManualVisitTargetPanelsProps) {
  const [drafts] = useState<ManualVisitDrafts>(() => new Map());
  useEffect(() => {
    const discard = () => drafts.clear();
    const clear = subscribeLocalDataClear(discard);
    const deletion = subscribeLocalSourceDeletion(discard, 'local');
    return () => {
      clear();
      deletion();
    };
  }, [drafts]);
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
        <Fragment key={sessionId + ':' + appointmentId + ':' + revision}>
          <ConversationSavedRecaps appointmentId={appointmentId} />
          <ManualVisitRecords appointmentId={appointmentId} drafts={drafts} />
        </Fragment>
      ))}
      {available &&
      durableSessionId &&
      discover &&
      messages.some(message => message.visitQuestionsUnavailable) ? (
        <RetainedManualVisitTargets
          key={durableSessionId}
          sessionId={durableSessionId}
          discover={discover}
          drafts={drafts}
          excluded={JSON.stringify([...targets.keys()])}
        />
      ) : null}
      {compact ? <Text style={styles.disclaimer}>{disclaimer}</Text> : null}
    </>
  );
}

import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useIsFocused } from '@react-navigation/native';
import { useConversationSessions } from '../ragConversation/ConversationSessionsContext';
import { useConversationPresentationSnapshot } from '../ragConversation/useConversationPresentationSnapshot';
import { ManualVisitTargetPanels } from '../ragConversation/ManualVisitTargetPanels';
import type { AiFeatureServices } from '../aiFeatures/integration/featureServiceTypes';

/** Reuse source-validated follow-up actions; hidden routes never keep a private editor mounted. */
export function OverviewPreparedVisits({
  appointmentId,
  discover,
}: {
  readonly appointmentId?: string;
  readonly discover?: AiFeatureServices['conversationArtifacts'];
}) {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const store = useConversationSessions();
  const snapshot = useConversationPresentationSnapshot(store);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state =>
      setActive(state === 'active'),
    );
    return () => subscription.remove();
  }, []);
  const session = snapshot.sessions.find(item => item.id === snapshot.activeId);
  if (!focused || !active || !session) return null;
  return (
    <ManualVisitTargetPanels
      content="questions"
      embedded
      appointmentId={appointmentId}
      store={store}
      sessionId={session.id}
      session={session}
      messages={session.messages}
      durableSessionId={store.toolSourceSessionId(session.id)}
      discover={discover}
      compact={false}
      disclaimer=""
    />
  );
}

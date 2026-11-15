import type { ComponentProps } from 'react';
import { ConversationComposer } from './ConversationComposer';
import { ConversationSteeringControls } from './ConversationSteeringControls';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

/** Binds the optional durable steering affordance without replacing the existing Stop action. */
export function ConversationSteeringComposer({
  session,
  store,
  ...props
}: Omit<
  ComponentProps<typeof ConversationComposer>,
  'value' | 'busy' | 'steeringControls'
> & { session: ConversationSession; store: ConversationSessions }) {
  return (
    <ConversationComposer
      {...props}
      value={session.draft}
      busy={session.busy}
      steeringControls={
        <ConversationSteeringControls
          session={session}
          onSend={() => {
            store.steer(session.id).catch(() => {});
          }}
        />
      }
    />
  );
}

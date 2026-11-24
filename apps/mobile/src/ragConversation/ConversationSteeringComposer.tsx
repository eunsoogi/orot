import type { ComponentProps } from 'react';
import { ConversationComposer } from './ConversationComposer';
import { ConversationSteeringControls } from './ConversationSteeringControls';
import { ConversationDirectPhotoComposer } from './ConversationDirectPhotoComposer';
import type {
  ConversationSession,
  ConversationSessions,
} from './conversationSessionTypes';

/** Routes typed in-flight messages through the current durable owner; empty input keeps Stop. */
export function ConversationSteeringComposer({
  session,
  store,
  isEntryCurrent,
  renderTrailingAction,
  ...props
}: Omit<
  ComponentProps<typeof ConversationComposer>,
  'value' | 'busy' | 'steeringControls' | 'onSteer' | 'steeringDisabled'
> & {
  session: ConversationSession;
  store: ConversationSessions;
  isEntryCurrent?: () => boolean;
  renderTrailingAction?: (
    photoOwned: boolean,
  ) => ComponentProps<typeof ConversationComposer>['trailingAction'];
}) {
  return (
    <ConversationDirectPhotoComposer
      key={session.id}
      session={session}
      store={store}
      isEntryCurrent={isEntryCurrent}
      renderTrailingAction={renderTrailingAction}
      composer={{
        ...props,
        value: session.draft,
        busy: session.busy || Boolean(session.preparingSend),
        onSteer: session.preparingSend
          ? undefined
          : () => {
              store.steer(session.id).catch(() => {});
            },
        steeringDisabled:
          !session.steeringAvailable || session.steeringSubmitting,
        steeringControls: <ConversationSteeringControls session={session} />,
      }}
    />
  );
}

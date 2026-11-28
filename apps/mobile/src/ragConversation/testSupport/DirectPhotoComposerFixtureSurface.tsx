import type { ReactNode } from 'react';
import { ConversationWorkspace } from '../ConversationWorkspace';
import { DirectPhotoPresentationScope } from '../DirectPhotoPresentationScope';
import type {
  ConversationSession,
  ConversationSessions,
} from '../conversationSessionTypes';
import { Transcript } from './savedHistoryDisplayFixture';

/** Use actual workspace route/phase paint rules for Send presentation tests. */
export function directPhotoComposerFixtureSurface(input: {
  store: ConversationSessions;
  session: ConversationSession;
  composer: ReactNode;
  entryChoices?: ReactNode;
  withWorkspace?: boolean;
  isEntryCurrent: () => boolean;
}) {
  const {
    store,
    session,
    composer,
    entryChoices,
    withWorkspace,
    isEntryCurrent,
  } = input;
  const transcript = <Transcript store={store} entryChoices={entryChoices} />;
  return withWorkspace ? (
    <ConversationWorkspace
      sourceActions={{ onOpenSource: () => {}, onLinkError: () => {} }}
      session={session}
      composer={composer}
      photoOwnerKey={store.directPhotoDrafts}
      isEntryCurrent={isEntryCurrent}
    >
      {transcript}
    </ConversationWorkspace>
  ) : (
    <DirectPhotoPresentationScope
      sessionId={session.id}
      ownerKey={store.directPhotoDrafts}
      available
    >
      {transcript}
      {composer}
    </DirectPhotoPresentationScope>
  );
}

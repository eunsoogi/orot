import { createContext, useContext } from 'react';
import type { NavigationContentFrame } from '../navigation/navigationContentFrame';

/** Presentation only: never changes the session or dispatch lifecycle. */
export const SeparatedConversationActivity = createContext(false);
export const useSeparatedConversationActivity = () =>
  useContext(SeparatedConversationActivity);

/** Window-space proof from the measured workspace, not a free-form pane flag. */
export const ConversationTranscriptTrailingLane = createContext<
  | {
      readonly frame: NavigationContentFrame;
      readonly right: number;
      readonly width: number;
    }
  | undefined
>(undefined);

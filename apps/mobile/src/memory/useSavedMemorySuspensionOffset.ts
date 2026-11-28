import { useLayoutEffect, useRef } from 'react';
import { AppState } from 'react-native';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import type { useNavigationRouteScrollPosition } from '../navigation/NavigationRouteScrollView';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import type { useSavedMemories } from './useSavedMemories';

type Position = ReturnType<typeof useNavigationRouteScrollPosition>;
type Read = ReturnType<typeof useSavedMemories>['readyRead'];
type FeedState = ReturnType<typeof useSavedMemories>['state'];
type Suspension = {
  priorRequest: number;
  restore: ReturnType<NonNullable<Position>['capture']>;
  admitted: () => Promise<boolean>;
  current: () => boolean;
};

/** Keep only scroll position through suspension, never a display or action grant. */
export function useSavedMemorySuspensionOffset({
  active,
  ownership,
  position,
  read,
  state,
}: {
  active: boolean;
  ownership?: NavigationRouteOwnership;
  position: Position;
  read: Read;
  state: FeedState;
}) {
  const latest = useRef(read);
  const held = useRef<Suspension | undefined>(undefined);
  const generation = useRef(0);
  useLayoutEffect(() => {
    latest.current = read;
    if (state === 'failed' || state === 'invalidated') {
      generation.current++;
      held.current = undefined;
    }
  }, [read, state]);
  useLayoutEffect(() => {
    if (!active || !ownership || !position) return;
    const native = conversationExecutionNative();
    if (!native?.bridgeAvailable) return;
    let foreground = AppState.currentState === 'active';
    const retire = () => {
      generation.current++;
      held.current = undefined;
    };
    const app = AppState.addEventListener('change', phase => {
      if (phase === 'inactive' || phase === 'background') {
        if (foreground) {
          retire();
          const priorRead = latest.current;
          const ticket = generation.current;
          if (priorRead && ownership.isCurrent())
            held.current = {
              priorRequest: priorRead.request,
              restore: position.capture(),
              admitted: async () =>
                (await native.protectedDataAvailable()) === true,
              current: () =>
                generation.current === ticket && ownership.isCurrent(),
            };
        }
      } else if (phase !== 'active') retire();
      foreground = phase === 'active';
    });
    const owner = ownership.subscribe(() => {
      if (!ownership.isCurrent()) retire();
    });
    const clear = subscribeLocalDataClear(retire);
    const deleted = subscribeLocalSourceDeletion(retire);
    const protection = native.subscribe(event => {
      if (event.kind === 'protectedData' && !event.available) retire();
    });
    return () => {
      retire();
      app.remove();
      owner();
      clear();
      deleted();
      protection();
    };
  }, [active, ownership, position]);
  useLayoutEffect(() => {
    const offset = held.current;
    if (!offset || !read || read.request === offset.priorRequest) return;
    held.current = undefined;
    const current = () =>
      offset.current() &&
      AppState.currentState === 'active' &&
      latest.current === read &&
      read.isCurrent();
    if (current())
      offset
        .admitted()
        .then(allowed => {
          if (allowed && current()) offset.restore(current);
        })
        .catch(() => undefined);
  }, [read]);
}

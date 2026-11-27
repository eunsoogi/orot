import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { createDirectPhotoDraftOwner } from './directPhotoDraftOwner';

type State = {
  images?: readonly string[];
  picking?: true;
  sending?: true;
  message?: string;
};

/** Picker/send interactions still belong to the mounted composer. Only idle
 * previews follow the exact session store through a route remount. */
export function useDirectPhotoDraftLifecycle({
  owner,
  sessionId,
  routeVisible,
  release,
}: {
  readonly owner: ReturnType<typeof createDirectPhotoDraftOwner>;
  readonly sessionId: number;
  readonly routeVisible: boolean;
  readonly release: (sceneLeaving: boolean) => void;
}) {
  const [interaction, setInteraction] = useState<State>({});
  const mounted = useRef(false);
  const settled = useSyncExternalStore(owner.subscribe, () =>
    owner.read(sessionId),
  );
  const setState = (next: State) => {
    if (next.picking || next.sending) {
      owner.clear(sessionId);
      setInteraction(next);
    } else {
      owner.replace(sessionId, next.images);
      setInteraction({ message: next.message });
    }
  };
  const discard = () => owner.clear(sessionId);
  const suspend = useCallback(
    (sceneLeaving: boolean) => {
      release(sceneLeaving);
      setInteraction({});
    },
    [release],
  );
  useEffect(() => {
    mounted.current = true;
    const interrupt = owner.interrupt(() => suspend(false));
    owner.connect();
    return () => {
      mounted.current = false;
      interrupt();
      release(true);
    };
  }, [owner, release, sessionId, suspend]);
  useEffect(() => {
    if (!routeVisible) suspend(true);
  }, [routeVisible, suspend]);

  const state: State = routeVisible
    ? {
        ...interaction,
        images:
          interaction.picking || interaction.sending
            ? interaction.images
            : settled,
      }
    : {};
  return {
    state,
    setState,
    mounted,
    paused: {
      get current() {
        return owner.paused();
      },
    },
    discard,
  };
}

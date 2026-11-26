import { useCallback, useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { conversationExecutionNative } from './conversationExecutionNative';

/** Only a settled, same-composer draft may survive an ordinary interruption.
 * It becomes visible again only after a fresh positive native protection read. */
export function useDirectPhotoDraftLifecycle(input: {
  readonly ownerKey: object;
  readonly sessionId: number;
  readonly routeVisible: boolean;
  readonly ownsDraft: () => boolean;
  readonly settledImage: () => string | undefined;
  readonly suspend: () => void;
  readonly release: () => void;
  readonly restore: (image: string) => void;
}) {
  const { ownerKey, release, routeVisible, sessionId, suspend } = input;
  const live = useRef(input);
  live.current = input;
  const mounted = useRef(false);
  const paused = useRef(false);
  const hidden = useRef<string | undefined>(undefined);
  const generation = useRef(0);
  const discard = useCallback(() => {
    ++generation.current;
    hidden.current = undefined;
  }, []);
  useEffect(() => {
    mounted.current = true;
    paused.current = false;
    const native = conversationExecutionNative();
    let locked = false;
    const retire = () => {
      locked = true;
      paused.current = true;
      discard();
      live.current.suspend();
    };
    const transition = (value: typeof AppState.currentState) => {
      if (value !== 'active') {
        ++generation.current;
        if (!paused.current)
          hidden.current =
            !locked && native?.bridgeAvailable && live.current.ownsDraft()
              ? live.current.settledImage()
              : undefined;
        paused.current = true;
        live.current.suspend();
        return;
      }
      const expected = ++generation.current;
      if (!hidden.current && !locked) {
        paused.current = false;
        return;
      }
      const finish = (safe: boolean) => {
        if (!mounted.current || generation.current !== expected) return;
        const image = hidden.current;
        hidden.current = undefined;
        locked = !safe;
        paused.current = !safe;
        if (
          image &&
          safe &&
          AppState.currentState === 'active' &&
          live.current.ownsDraft()
        )
          live.current.restore(image);
      };
      Promise.resolve()
        .then(() => native?.protectedDataAvailable())
        .then(
          available => finish(available === true),
          () => finish(false),
        );
    };
    const stop = native?.subscribe(event => {
      if (event.kind !== 'protectedData') return;
      if (!event.available) retire();
      else if (locked && AppState.currentState === 'active')
        transition('active');
    });
    const phase = AppState.addEventListener('change', transition);
    return () => {
      mounted.current = false;
      discard();
      release();
      phase.remove();
      stop?.();
    };
  }, [discard, ownerKey, release, sessionId]);
  useEffect(() => {
    if (routeVisible) return;
    discard();
    suspend();
  }, [discard, routeVisible, suspend]);
  return { mounted, paused, discard };
}

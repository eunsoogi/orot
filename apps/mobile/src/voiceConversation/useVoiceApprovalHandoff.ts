import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

interface Presentation {
  readonly callId: string;
  dismissed: boolean;
}
interface Pending {
  readonly presentation: Presentation;
  readonly controller: AbortController;
  readonly start: () => void;
  readonly finish: (value: unknown) => void;
}

/** Dismiss only the voice UI before presenting approvals; never change the native call. */
export function useVoiceApprovalHandoff(input: {
  readonly callId: string | null;
  readonly visible: boolean;
}) {
  const live = useRef(input);
  live.current = input;
  const mounted = useRef(false);
  const pending = useRef<Pending | null>(null);
  const presentation = useRef<Presentation | null>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Presentation | null>(null);
  const cancel = useCallback(() => {
    const current = pending.current;
    if (!current) return;
    // Settle immediately even if downstream work ignores cancellation.
    current.controller.abort();
    current.finish(null);
  }, []);
  useEffect(() => {
    mounted.current = true;
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') cancel();
    });
    return () => {
      mounted.current = false;
      cancel();
      presentation.current = null;
      subscription.remove();
    };
  }, [cancel]);
  useEffect(() => {
    const current = presentation.current;
    if (current && (!input.visible || input.callId !== current.callId)) {
      cancel();
      // Ending a call while the screen is still logically open must not reopen
      // its modal over the approval sheet. Only a closed route or new call resets it.
      if (!input.visible || input.callId) {
        presentation.current = null;
        setShown(null);
      }
    }
  }, [input.callId, input.visible, cancel]);

  const run = useCallback(
    <T>(
      signal: AbortSignal,
      work: (signal: AbortSignal) => Promise<T>,
    ): Promise<T | null> => {
      const owner = live.current;
      if (
        !mounted.current ||
        !owner.visible ||
        !owner.callId ||
        signal.aborted ||
        AppState.currentState !== 'active' ||
        pending.current
      )
        return Promise.resolve(null);
      // A second action may reuse an already dismissed surface, but never a stale call.
      const view =
        presentation.current?.callId === owner.callId
          ? presentation.current
          : { callId: owner.callId, dismissed: false };
      presentation.current = view;
      setShown(view);
      return new Promise<T | null>(resolve => {
        const controller = new AbortController();
        let settled = false;
        let started = false;
        let drained = false;
        const valid = () =>
          mounted.current &&
          live.current.visible &&
          live.current.callId === view.callId &&
          presentation.current === view &&
          !controller.signal.aborted &&
          !signal.aborted &&
          AppState.currentState === 'active';
        const onAbort = () => {
          controller.abort();
          finish(null);
        };
        const finish = (value: unknown) => {
          if (
            (!started || drained) &&
            pending.current?.controller === controller
          ) {
            pending.current = null;
            if (mounted.current) setBusy(false);
          }
          if (settled) return;
          settled = true;
          signal.removeEventListener('abort', onAbort);
          resolve(valid() ? (value as T | null) : null);
          // Keep the UI suspended. A resolved consent is not proof its native sheet dismissed.
        };
        const start = () => {
          if (settled || !valid()) {
            finish(null);
            return;
          }
          started = true;
          Promise.resolve()
            .then(() => {
              if (!valid()) return null;
              return work(controller.signal);
            })
            .then(
              value => {
                drained = true;
                finish(value);
              },
              () => {
                drained = true;
                finish(null);
              },
            );
        };
        pending.current = { presentation: view, controller, start, finish };
        setBusy(true);
        signal.addEventListener('abort', onAbort, { once: true });
        if (signal.aborted) onAbort();
        else if (view.dismissed) start();
      });
    },
    [],
  );
  const onVoiceDismiss = useCallback(() => {
    // The callback belongs to the render that hid this particular call's modal.
    if (
      !shown ||
      presentation.current !== shown ||
      !live.current.visible ||
      live.current.callId !== shown.callId ||
      shown.dismissed
    )
      return;
    shown.dismissed = true;
    if (pending.current?.presentation === shown) pending.current.start();
  }, [shown]);
  const resume = useCallback(() => {
    const current = presentation.current;
    if (
      !mounted.current ||
      pending.current ||
      !current?.dismissed ||
      !live.current.visible ||
      live.current.callId !== current.callId ||
      AppState.currentState !== 'active'
    )
      return false;
    presentation.current = null;
    setShown(null);
    return true;
  }, []);
  const suspended = Boolean(
    shown && input.visible && (!input.callId || shown.callId === input.callId),
  );
  return {
    voiceVisible: input.visible && !suspended,
    busy,
    suspended,
    onVoiceDismiss,
    run,
    resume,
    cancel,
  };
}

import { confirmOverviewWorkoutProtection } from './overviewWorkoutProtection';
import type { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';

type Protection = NonNullable<ReturnType<typeof conversationExecutionNative>>;
type Event = Parameters<Parameters<Protection['subscribe']>[0]>[0];
export type WorkoutForegroundOwner = {
  foreground?: (active: boolean) => void;
  settled?: boolean;
  interrupted?: boolean;
  reconfirming?: boolean;
  usable?: () => boolean;
  recover?: () => Promise<void>;
};

export function createOverviewWorkoutForeground<
  T extends WorkoutForegroundOwner,
>(input: {
  phase: () => string;
  owner: () => T | undefined;
  current: (target: T) => boolean;
  confirm: (target: T) => Promise<boolean>;
  retire: (showUnavailable?: boolean) => void;
  start: () => void;
  pause: () => void;
  restored: () => void;
  pending: () => void;
}) {
  const {
    phase,
    owner,
    current,
    confirm,
    retire,
    start,
    pause,
    restored,
    pending,
  } = input;
  let inactiveSince: number | undefined;
  function foreground() {
    if (phase() !== 'active') return;
    const wasInactive = inactiveSince !== undefined;
    const pausedFor =
      inactiveSince === undefined ? 0 : Date.now() - inactiveSince;
    inactiveSince = undefined;
    const existing = owner();
    if (existing && (pausedFor > 5_000 || existing.usable?.() === false)) {
      // A retired snapshot is not an empty or denied result. The parent
      // selection may still be revalidating before its successor can start.
      retire(false);
      pending();
    }
    const target = owner();
    if (!target) {
      start();
      return;
    }
    const ready = target.foreground;
    target.foreground = undefined;
    ready?.(true);
    if (target.settled && wasInactive && !target.reconfirming) {
      target.reconfirming = true;
      confirm(target)
        .then(async valid => {
          if (valid && current(target) && !target.usable?.()) {
            pending();
            await target.recover?.();
          }
          if (current(target) && (!valid || !target.usable?.())) retire();
        })
        .catch(() => {
          if (current(target)) retire();
        })
        .finally(() => {
          target.reconfirming = false;
        });
    }
  }
  return (event: Event) => {
    if (event.kind === 'protectedData' && !event.available) retire();
    else if (event.kind === 'protectedData') {
      restored();
      foreground();
    } else if (event.kind === 'foreground') foreground();
    else if (event.kind === 'phase') {
      if (phase() === 'inactive') {
        pause();
        inactiveSince ??= Date.now();
        const active = owner();
        if (active && !active.settled) active.interrupted = true;
      } else if (phase() === 'active') foreground();
      else if (phase() === 'background') {
        pause();
        retire(false);
        pending();
      } else retire();
    }
  };
}

export function confirmProtection<T extends WorkoutForegroundOwner>(
  current: (owner: T) => boolean,
  phase: () => string,
  probe: ReturnType<
    typeof import('../../healthkit/workoutProtectionProbe').createWorkoutProtectionProbe
  >,
  protection: Protection,
) {
  return confirmOverviewWorkoutProtection(current, phase, target =>
    probe.confirm(() => current(target), protection.protectedDataAvailable),
  );
}

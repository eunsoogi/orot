type ReadWaiter = {
  foreground?: (isActive: boolean) => void;
};

/** Inactive is allowed to park an existing local read, but cannot authorize data
 * until foreground and native data protection are both positively confirmed. */
export function confirmOverviewWorkoutProtection<T extends ReadWaiter>(
  current: (owner: T) => boolean,
  phase: () => string,
  protectedDataAvailable: () => Promise<boolean | null>,
) {
  const waitForForeground = (target: T) => {
    if (!current(target)) return Promise.resolve(false);
    if (phase() === 'active') return Promise.resolve(true);
    if (phase() !== 'inactive') return Promise.resolve(false);
    return new Promise<boolean>(resolve => {
      target.foreground = resolve;
    });
  };
  return async (target: T) => {
    while (await waitForForeground(target)) {
      if (!current(target)) return false;
      const available = await protectedDataAvailable();
      if (!current(target) || available !== true) return false;
      if (phase() === 'active') return true;
    }
    return false;
  };
}

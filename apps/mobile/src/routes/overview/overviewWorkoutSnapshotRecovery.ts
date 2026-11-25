/** A no-longer-current SQLite epoch can be replaced once, only inside the same
 * route/window/database scope. Settlement cannot authorize the replacement by itself. */
export async function canReacquireOverviewWorkoutSnapshot(
  epochCurrent: boolean | undefined,
  scopeCurrent: () => boolean,
  awaitWriter: () => Promise<boolean>,
  confirmProtection: () => Promise<boolean>,
) {
  return (
    epochCurrent === false &&
    scopeCurrent() &&
    (await awaitWriter()) &&
    scopeCurrent() &&
    (await confirmProtection()) &&
    scopeCurrent()
  );
}

/** The existing rolling seven-day period uses local midnights. Crossing a
 * local midnight or time-zone change retires the current period selection. */
export function overviewWorkoutReadWindow(now: Date) {
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - 6);
  const midnight = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  ).getTime();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return {
    period: {
      fromInclusive: from.toISOString(),
      toExclusive: now.toISOString(),
    },
    midnight,
    currentWindow: () =>
      Date.now() < midnight &&
      zone === Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

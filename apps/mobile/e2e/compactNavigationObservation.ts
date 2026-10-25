type Fields = Record<string, unknown>;
const fields = (value: unknown): Fields =>
  value !== null && typeof value === 'object' ? (value as Fields) : {};
const number = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const rounded = Math.round(value * 10) / 10;
  return Number.isFinite(rounded) ? rounded : undefined;
};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** A companion label fits truncated UI observations; the full native marker remains unchanged for existing consumers. */
export function compactNavigationObservation(value: unknown): string {
  const snapshot = fields(value);
  const navigation = list(snapshot.navigation);
  const events = list(snapshot.events);
  const latest = events.length > 0 ? fields(events[events.length - 1]) : null;
  const roles = latest
    ? list(latest.publicPopControllers).flatMap(controller =>
        list(fields(controller).roles).filter(
          role => role === 'edge-pop' || role === 'content-pop',
        ),
      )
    : [];
  return JSON.stringify({
    atMs: number(snapshot.atMs),
    navigationCount: navigation.length,
    // Count remains explicit when deeply nested navigation exceeds this observation's display budget.
    depths: navigation
      .slice(0, 4)
      .map(item => number(fields(item).depth) ?? null),
    eventCount: events.length,
    latest: latest
      ? {
          state: number(latest.state),
          depth: number(latest.controllerDepth),
          dx: number(latest.translationX),
          dy: number(latest.translationY),
          vx: number(latest.velocityX),
          roles: [...new Set(roles)],
        }
      : null,
  });
}

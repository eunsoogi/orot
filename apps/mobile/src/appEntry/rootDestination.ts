import type { AppRootTab } from '../navigation/rootTabs';

export const rootDestinations = [
  'conversation',
  'overview',
  'records',
  'schedule',
  'settings',
] as const;
export type RootDestination = (typeof rootDestinations)[number];

/** Normalize legacy destination identifiers only at an external input boundary. */
export function normalizeRootDestination(
  value: unknown,
): RootDestination | null {
  if (value === 'ai') return 'conversation';
  if (value === 'home') return 'overview';
  return rootDestinations.find(destination => destination === value) ?? null;
}

/** Public URLs are a narrow allowlist; never retain the raw URL or interpret it as a prompt. */
export function decodeRootURL(raw: string): RootDestination | null {
  const match =
    /^orot:\/\/open\/v1\/(conversation|overview|records|schedule|settings|ai|home)$/.exec(
      raw,
    );
  return match?.[0] === raw ? normalizeRootDestination(match[1]) : null;
}

/** Public destinations and the current tab model share one canonical identity. */
export function rootDestinationTab(destination: RootDestination): AppRootTab {
  return destination;
}

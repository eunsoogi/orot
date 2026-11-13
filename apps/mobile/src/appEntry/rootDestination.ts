import type { AppRootTab } from '../navigation/rootTabs';

export const rootDestinations = [
  'conversation',
  'overview',
  'records',
  'schedule',
  'settings',
] as const;
export type RootDestination = (typeof rootDestinations)[number];

/** Public URLs are a narrow allowlist; never retain the raw URL or interpret it as a prompt. */
export function decodeRootURL(raw: string): RootDestination | null {
  const match =
    /^orot:\/\/open\/v1\/(conversation|overview|records|schedule|settings)$/.exec(
      raw,
    );
  return match?.[0] === raw ? (match[1] as RootDestination) : null;
}

/** The public descriptor stays stable when internal root tab names change. */
export function rootDestinationTab(destination: RootDestination): AppRootTab {
  if (destination === 'conversation') return 'ai';
  if (destination === 'overview') return 'home';
  return destination;
}

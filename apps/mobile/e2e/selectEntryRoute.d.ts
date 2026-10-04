export type E2EEntryRoute = 'storage' | 'agent-memory' | 'graph';

export function selectEntryRoute(settings: Record<string, unknown>): E2EEntryRoute;

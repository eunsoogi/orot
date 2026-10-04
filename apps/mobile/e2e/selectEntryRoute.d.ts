export type E2EEntryRoute = 'storage' | 'agent-memory' | 'graph' | 'checkpoint';

export function selectEntryRoute(settings: Record<string, unknown>): E2EEntryRoute;

export type E2EEntryRoute = 'storage' | 'agent-memory' | 'appointments' | 'graph' | 'checkpoint';

export function selectEntryRoute(settings: Record<string, unknown>): E2EEntryRoute;

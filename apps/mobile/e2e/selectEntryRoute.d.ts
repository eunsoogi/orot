export type E2EEntryRoute =
  | 'storage'
  | 'agent-memory'
  | 'appointments'
  | 'graph'
  | 'checkpoint'
  | 'safe-area';

export function selectEntryRoute(
  settings: Record<string, unknown>,
): E2EEntryRoute;

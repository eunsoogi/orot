export type E2EEntryRoute =
  | 'storage'
  | 'agent-memory'
  | 'appointments'
  | 'medical-appointment-classification'
  | 'graph'
  | 'checkpoint'
  | 'safe-area'
  | 'safe-area-blood-pressure';

export function selectEntryRoute(
  settings: Record<string, unknown>,
): E2EEntryRoute;

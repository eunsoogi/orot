export type E2EEntryRoute =
  | 'storage'
  | 'agent-memory'
  | 'appointments'
  | 'medical-appointment-classification'
  | 'medical-appointment-app-navigation'
  | 'graph'
  | 'checkpoint'
  | 'safe-area'
  | 'safe-area-blood-pressure'
  // Opts into the real app and visit-question route with synthetic operations.
  | 'ai-feature-visit-questions';

export function selectEntryRoute(
  settings: Record<string, unknown>,
): E2EEntryRoute;

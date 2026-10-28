export type E2EEntryRoute =
  | 'storage'
  | 'agent-memory'
  | 'appointments'
  | 'medical-appointment-classification'
  | 'medical-appointment-app-navigation'
  | 'medical-document-import'
  | 'graph'
  | 'checkpoint'
  | 'safe-area'
  | 'safe-area-blood-pressure'
  // Opts into the real app and visit-question route with synthetic operations.
  | 'ai-feature-visit-questions'
  // Opts into the real symptom route with a session-only save-failure fixture.
  | 'symptom-journal-save-recovery';

export function selectEntryRoute(
  settings: Record<string, unknown>,
): E2EEntryRoute;

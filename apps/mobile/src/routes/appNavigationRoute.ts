/** Route identifiers kept by the guarded app navigation controller. */
export type AppNavigationRoute =
  | AiFeatureRouteName
  | 'root'
  | 'recording'
  | 'saved-recordings'
  | 'recent-records'
  | 'medical-document-detail'
  | 'saved-memory-detail'
  | 'recording-review'
  | 'unified-import'
  | 'health-records'
  | 'health-records-detail'
  | 'manual-history'
  | 'appointments'
  | 'appointment-preparation'
  | 'visit-day-questions'
  | 'medical'
  | 'medical-manual'
  | 'settings-provider'
  | 'settings-accounts'
  | 'settings-backup'
  | 'settings-privacy'
  | 'settings-health-data'
  | 'settings-sync-status';
import type { AiFeatureRouteName } from '../aiFeatures/integration/aiFeatureNavigation';

/** Route identifiers kept by the guarded app navigation controller. */
export type AppNavigationRoute =
  | AiFeatureRouteName
  | 'home'
  | 'recording'
  | 'saved-recordings'
  | 'symptoms'
  | 'recording-review'
  | 'health-review'
  | 'health-review-source'
  | 'unified-import'
  | 'health-records'
  | 'health-records-detail'
  | 'manual-history'
  | 'appointments'
  | 'appointment-preparation'
  | 'medical'
  | 'medical-manual'
  | 'settings-provider'
  | 'settings-accounts'
  | 'settings-backup'
  | 'settings-privacy'
  | 'settings-health-data'
  | 'settings-sync-status';
import type { AiFeatureRouteName } from '../aiFeatures/integration/aiFeatureNavigation';

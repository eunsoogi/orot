/** Route identifiers kept by the guarded app navigation controller. */
export type AppNavigationRoute =
  | AiFeatureRouteName
  | 'home'
  | 'recording'
  | 'saved-recordings'
  | 'recording-review'
  | 'unified-import'
  | 'health-records'
  | 'health-records-detail'
  | 'appointments'
  | 'medical'
  | 'medical-manual'
  | 'settings-provider'
  | 'settings-accounts'
  | 'settings-backup'
  | 'settings-privacy'
  | 'settings-health-data'
  | 'settings-sync-status';
import type { AiFeatureRouteName } from '../aiFeatures/integration/aiFeatureNavigation';

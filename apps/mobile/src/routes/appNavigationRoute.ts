/** Route identifiers kept by the guarded app navigation controller. */
export type AppNavigationRoute =
  | AiFeatureRouteName
  | 'home'
  | 'recording'
  | 'unified-import'
  | 'common-observations'
  | 'blood-pressure'
  | 'health-records'
  | 'appointments'
  | 'medical'
  | 'medical-manual'
  | 'settings-provider'
  | 'settings-accounts'
  | 'settings-backup'
  | 'settings-privacy';
import type { AiFeatureRouteName } from '../aiFeatures/integration/aiFeatureNavigation';

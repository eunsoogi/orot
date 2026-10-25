import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection';
import type { AiFeatureServiceDependencies } from '../aiFeatures/integration/featureServices';
import type { BackupPreparationDisplayState } from '../backup/useBackupPreparation';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import { SettingsAccountsRoute } from './SettingsAccountsRoute';
import { SettingsBackupRoute } from './SettingsBackupRoute';
import { SettingsPrivacyRoute } from './SettingsPrivacyRoute';
import { SettingsProviderRoute } from './SettingsProviderRoute';
import { HealthDataIntegrationRoute } from './HealthDataIntegrationRoute';
import { SettingsSyncStatusRoute } from './SettingsSyncStatusRoute';
import type { AppNavigationRoute } from './appNavigationRoute';
import type { CalendarAutoSyncActions } from '../calendar/useCalendarAutoSync';

interface SettingsDetailsRouteProps {
  readonly route: AppNavigationRoute;
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly backupState: BackupPreparationDisplayState;
  readonly calendarSync: CalendarAutoSyncActions;
  readonly onPrepareBackup: () => Promise<void>;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
  readonly onSelectionCommitted: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
}

/** Keeps Settings-only destinations in the shared guarded app route stack. */
export function SettingsDetailsRoute({
  route,
  actions,
  backupState,
  calendarSync,
  onPrepareBackup,
  serviceDependencies,
  onSelectionCommitted,
}: SettingsDetailsRouteProps) {
  switch (route) {
    case 'settings-provider':
      return (
        <SettingsProviderRoute
          actions={actions}
          onSelectionCommitted={onSelectionCommitted}
          serviceDependencies={serviceDependencies}
        />
      );
    case 'settings-accounts':
      return (
        <SettingsAccountsRoute
          actions={actions}
          onSelectionCommitted={onSelectionCommitted}
          serviceDependencies={serviceDependencies}
        />
      );
    case 'settings-backup':
      return (
        <SettingsBackupRoute state={backupState} onPrepare={onPrepareBackup} />
      );
    case 'settings-privacy':
      return <SettingsPrivacyRoute />;
    case 'settings-health-data':
      return <HealthDataIntegrationRoute />;
    case 'settings-sync-status':
      return (
        <SettingsSyncStatusRoute
          calendarSync={calendarSync}
          onConfigureHealthData={() => actions.push('settings-health-data')}
        />
      );
    default:
      return null;
  }
}

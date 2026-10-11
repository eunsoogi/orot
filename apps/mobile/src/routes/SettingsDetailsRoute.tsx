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
import type { AppNavigationRoute } from './appNavigationRoute';

interface SettingsDetailsRouteProps {
  readonly route: AppNavigationRoute;
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly backupState: BackupPreparationDisplayState;
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
    default:
      return null;
  }
}

import { useState } from 'react';
import { ProviderSelectionFlow } from '../providers/selection';
import type {
  ProviderSelection,
  ProviderSelectionOption,
} from '../providers/selection';
import type { ProviderSelectionNavigationState } from '../providers/selection/ProviderSelectionFlow';
import type { AiFeatureServiceDependencies } from '../aiFeatures/integration/featureServices';
import { t } from '../i18n';
import type { NavigationRouteActions } from '../navigation/NavigationRouteAdapter';
import { useNavigationLeaveStateRegistration } from '../navigation';
import type { AppNavigationRoute } from './appNavigationRoute';

interface SettingsAccountsRouteProps {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
  readonly onSelectionCommitted: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
}

/** Keeps account authentication guarded while hiding unrelated model choices. */
export function SettingsAccountsRoute({
  actions,
  serviceDependencies,
  onSelectionCommitted,
}: SettingsAccountsRouteProps) {
  const [state, setState] = useState<ProviderSelectionNavigationState>({
    hasPendingSelection: false,
    isSavingSelection: false,
    isSigningIn: false,
    revision: 0,
    inputRevision: 0,
  });
  useNavigationLeaveStateRegistration({
    canLeave: !state.isSavingSelection,
    hasUnsavedChanges: state.hasPendingSelection,
    isRecording: false,
    hasOngoingOperation: state.isSigningIn,
    ongoingOperationKind: state.isSigningIn ? 'account-connection' : undefined,
    revision: state.revision,
    inputRevision: state.inputRevision,
  });

  return (
    <ProviderSelectionFlow
      presentation="settings-accounts"
      navigationRouteKey={actions.route.key}
      onBack={async () => {
        await actions.onBack().catch(() => undefined);
      }}
      onNavigationStateChange={setState}
      onSelectionCommitted={async (selection, provider) => {
        onSelectionCommitted(selection, provider);
        await actions.onBack().catch(() => undefined);
      }}
      safeAreaHandledByParent
      screenIntroduction={t('settings.accountsSummary')}
      screenTitle={t('settings.accounts')}
      selectionStore={serviceDependencies?.selectedAi?.selectionStore}
      chatGPTServices={serviceDependencies?.selectedAi?.chatGPTServices}
      loadAppleOption={serviceDependencies?.selectedAi?.loadAppleOption}
    />
  );
}

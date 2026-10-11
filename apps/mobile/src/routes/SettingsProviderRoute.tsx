import { useEffect, useState } from 'react';
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

interface SettingsProviderRouteProps {
  readonly actions: NavigationRouteActions<AppNavigationRoute>;
  readonly serviceDependencies?: AiFeatureServiceDependencies;
  readonly onSelectionCommitted: (
    selection: ProviderSelection,
    provider: ProviderSelectionOption['provider'],
  ) => void;
}

/** Offers model choices while sending sign-in and sign-out to Connected Accounts. */
export function SettingsProviderRoute({
  actions,
  serviceDependencies,
  onSelectionCommitted,
}: SettingsProviderRouteProps) {
  const [state, setState] = useState<ProviderSelectionNavigationState>({
    hasPendingSelection: false,
    isSavingSelection: false,
    isSigningIn: false,
    revision: 0,
    inputRevision: 0,
  });
  const [returnAfterSelection, setReturnAfterSelection] = useState(false);
  useEffect(() => {
    if (
      !returnAfterSelection ||
      state.hasPendingSelection ||
      state.isSavingSelection ||
      state.isSigningIn
    ) {
      return;
    }
    setReturnAfterSelection(false);
    actions.onBack().catch(() => undefined);
  }, [actions, returnAfterSelection, state]);
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
      presentation="settings-provider"
      navigationRouteKey={actions.route.key}
      onBack={async () => {
        await actions.onBack().catch(() => undefined);
      }}
      onOpenAccounts={() => actions.push('settings-accounts')}
      onNavigationStateChange={setState}
      onSelectionCommitted={async (selection, provider) => {
        onSelectionCommitted(selection, provider);
        setReturnAfterSelection(true);
      }}
      safeAreaHandledByParent
      screenIntroduction={t('settings.providerSummary')}
      screenTitle={t('settings.provider')}
      selectionStore={serviceDependencies?.selectedAi?.selectionStore}
      chatGPTServices={serviceDependencies?.selectedAi?.chatGPTServices}
      loadAppleOption={serviceDependencies?.selectedAi?.loadAppleOption}
    />
  );
}

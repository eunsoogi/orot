import { useCallback, useMemo, useState } from 'react';
import { AppRegistry } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import { SettingsRoute } from '../src/routes/SettingsRoute';
import { SettingsProviderRoute } from '../src/routes/SettingsProviderRoute';
import type { AppNavigationRoute } from '../src/routes/appNavigationRoute';
import { appContentLayoutOwner } from '../src/navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import type { NavigationRouteActions } from '../src/navigation/NavigationRouteAdapter';
import type {
  ProviderSelection,
  ProviderSelectionStore,
} from '../src/providers/selection/types';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import { name as appName } from '../app.json';

const fixtureAccount = {
  issuedClientID: 'synthetic-settings-layout-account',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};
let storedSelection: ProviderSelection | null = null;

const selectionStore: ProviderSelectionStore = {
  load: async () => storedSelection,
  save: async selection => {
    storedSelection = selection;
  },
  clear: async () => {
    storedSelection = null;
  },
};

// The native scenario uses synthetic catalog state; authentication actions fail closed without touching Keychain.
const chatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () => [fixtureAccount],
  listModels: async () =>
    providerSuccess([
      {
        id: 'synthetic-settings-model',
        slug: 'synthetic-settings-model',
        displayName: 'Synthetic settings model',
      },
    ]),
  signIn: async () => {
    throw new Error('The layout fixture does not support sign-in.');
  },
  signOut: async () => {
    throw new Error('The layout fixture does not support sign-out.');
  },
  cancelSignIn: () => undefined,
};

const serviceDependencies: AiFeatureServiceDependencies = {
  selectedAi: {
    selectionStore,
    chatGPTServices,
    loadAppleOption: async () => createAppleSelectionOption('available'),
  },
};

// Host the real Settings provider route under the production adapter and geometry policy.
function SettingsProviderLayoutProbe() {
  const controller = useMemo(
    () => createNavigationController<AppNavigationRoute>('home'),
    [],
  );
  const [selectedProvider, setSelectedProvider] = useState(
    'Synthetic current provider',
  );
  const onSelectionCommitted = useCallback(
    (
      _selection: ProviderSelection,
      provider: { readonly displayName: string },
    ) => {
      setSelectedProvider(provider.displayName);
    },
    [],
  );

  return (
    <NavigationRouteAdapter
      contentLayoutOwner={appContentLayoutOwner}
      controller={controller}
      rootTabs={route =>
        route.name === 'home'
          ? { activeTab: 'settings', onSelect: () => undefined }
          : undefined
      }
      scrollable={route => route.name === 'home'}
      showHome
    >
      {actions => renderRoute(actions, selectedProvider, onSelectionCommitted)}
    </NavigationRouteAdapter>
  );
}

function renderRoute(
  actions: NavigationRouteActions<AppNavigationRoute>,
  selectedProvider: string,
  onSelectionCommitted: (
    selection: ProviderSelection,
    provider: { readonly displayName: string },
  ) => void,
) {
  if (actions.route.name === 'settings-provider') {
    return (
      <SettingsProviderRoute
        actions={actions}
        onSelectionCommitted={onSelectionCommitted}
        serviceDependencies={serviceDependencies}
      />
    );
  }
  if (actions.route.name !== 'home') return null;

  return (
    <SettingsRoute
      selectedProvider={selectedProvider}
      onOpenProviderSettings={() => actions.push('settings-provider')}
      onOpenAccounts={() => undefined}
      onOpenPrivacy={() => undefined}
      onOpenBackup={() => undefined}
      onOpenHealthData={() => undefined}
      onOpenSyncStatus={() => undefined}
    />
  );
}

AppRegistry.registerComponent(appName, () => SettingsProviderLayoutProbe);

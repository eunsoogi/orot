import { useMemo } from 'react';
import { AppRegistry } from 'react-native';
import { providerSuccess } from '@orot/model-runtime';
import type { AiFeatureServiceDependencies } from '../src/aiFeatures/integration/featureServices';
import { appContentLayoutOwner } from '../src/navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../src/navigation/NavigationRouteAdapter';
import { createNavigationController } from '../src/navigation/navigationController';
import type { NavigationRouteActions } from '../src/navigation/NavigationRouteAdapter';
import type { AppNavigationRoute } from '../src/routes/appNavigationRoute';
import { SettingsAccountsRoute } from '../src/routes/SettingsAccountsRoute';
import { SettingsRoute } from '../src/routes/SettingsRoute';
import { createAppleSelectionOption } from '../src/providers/selection/options';
import type { ChatGPTSelectionServices } from '../src/providers/selection/chatGPTServices';
import type { ProviderSelectionStore } from '../src/providers/selection/types';
import { name as appName } from '../app.json';

const fixtureAccount = {
  issuedClientID: 'synthetic-settings-account-layout',
  requiresSignIn: false,
  hasDirectPlanAccess: true,
};

const selectionStore: ProviderSelectionStore = {
  load: async () => null,
  save: async () => undefined,
  clear: async () => undefined,
};

// The account layout probe never reads credentials; auth actions fail closed if reached.
const chatGPTServices: ChatGPTSelectionServices = {
  listAccounts: async () => [fixtureAccount],
  listModels: async () =>
    providerSuccess([
      {
        id: 'synthetic-settings-account-model',
        slug: 'synthetic-settings-account-model',
        displayName: 'Synthetic account layout model',
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

// Keep this fixture on the production adapter while selecting only Settings accounts.
function SettingsAccountsLayoutProbe() {
  const controller = useMemo(
    () => createNavigationController<AppNavigationRoute>('home'),
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
      {actions => renderRoute(actions)}
    </NavigationRouteAdapter>
  );
}

function renderRoute(actions: NavigationRouteActions<AppNavigationRoute>) {
  if (actions.route.name === 'settings-accounts') {
    return (
      <SettingsAccountsRoute
        actions={actions}
        onSelectionCommitted={() => undefined}
        serviceDependencies={serviceDependencies}
      />
    );
  }
  if (actions.route.name !== 'home') return null;

  return (
    <SettingsRoute
      selectedProvider="Synthetic current provider"
      onOpenProviderSettings={() => undefined}
      onOpenAccounts={() => actions.push('settings-accounts')}
      onOpenPrivacy={() => undefined}
      onOpenBackup={() => undefined}
      onOpenHealthData={() => undefined}
      onOpenSyncStatus={() => undefined}
    />
  );
}

AppRegistry.registerComponent(appName, () => SettingsAccountsLayoutProbe);

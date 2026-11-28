import { render } from '@testing-library/react-native';
import { recordsRouteTestProps } from './recordsRouteTestProps';
import { AppRouteContent } from '../AppRouteContent';
import { RecordsHubSection } from '../RecordsHubSection';
import {
  appContentLayoutOwner,
  appRouteIsScrollable,
} from '../../navigation/appContentLayoutPolicy';
import { NavigationRouteAdapter } from '../../navigation/NavigationRouteAdapter';
import { createNavigationController } from '../../navigation/navigationController';
import type { AppNavigationRoute } from '../appNavigationRoute';
import { RecordSourceNavigationProvider } from '../RecordSourceNavigation';

export async function renderRecordsRouteTest() {
  const controller = createNavigationController<AppNavigationRoute>('root');
  const props = recordsRouteTestProps();
  await render(
    <RecordSourceNavigationProvider>
      <NavigationRouteAdapter
        controller={controller}
        contentLayoutOwner={appContentLayoutOwner}
        scrollable={route =>
          route.name !== 'root' && appRouteIsScrollable(route, 'records')
        }
        rootTabs={route =>
          route.name === 'root'
            ? { activeTab: 'records', onSelect: jest.fn() }
            : undefined
        }
      >
        {actions =>
          actions.route.name === 'root' ? (
            <RecordsHubSection>
              <AppRouteContent {...props} actions={actions} />
            </RecordsHubSection>
          ) : (
            <AppRouteContent {...props} actions={actions} />
          )
        }
      </NavigationRouteAdapter>
    </RecordSourceNavigationProvider>,
  );
  return controller;
}

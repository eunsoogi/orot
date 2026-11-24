import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { createNavigationController } from '../../navigation/navigationController';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
} from '../../navigation/navigationGeometry';
import { resolveNavigationRootLayout } from '../../navigation/navigationRootLayout';
import {
  openGeometry,
  rotatedGeometry,
} from '../../navigation/__fixtures__/navigationOpenGeometry';
import { conversationExecutionNative } from '../../ragConversation/conversationExecutionNative';
import type { AppNavigationRoute } from '../appNavigationRoute';
import {
  recentRouteProps,
  recentTestExecution,
  renderRecords,
} from '../testSupport/recentRecordsRouteTestSupport';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../ragConversation/conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));
jest.mock('../../generatedReports/recentMaterialReader', () => ({
  loadRecentMaterial: jest.fn(async () => []),
}));

async function geometry(value: NavigationGeometryPayload) {
  await fireEvent(
    screen.getByTestId('navigation-window-geometry-sensor'),
    'geometryChange',
    { nativeEvent: value },
  );
}

async function verifyBack(value: NavigationGeometryPayload) {
  const layout = resolveNavigationRootLayout(
    createNavigationGeometrySnapshot(value),
  );
  if (layout.placement !== 'right' || layout.railSide === 'left')
    throw new Error('Expected an admitted right rail fixture');
  await waitFor(() => {
    const rail = screen.getByTestId('navigation-right-rail');
    expect(rail.props).toMatchObject({
      layoutMode: 'right',
      railBackTopInset: layout.railTopInset,
      railAvailableHeight: layout.windowHeight,
      actions: [
        expect.objectContaining({ id: 'back', testID: 'navigation-back' }),
      ],
    });
    expect(screen.getAllByTestId('navigation-back')).toHaveLength(1);
    expect(screen.getByTestId('navigation-back')).toBeEnabled();
    const dock = screen.queryByTestId('navigation-page-action-surface');
    if (dock) {
      expect(dock.props.railBackTopInset).toBeUndefined();
      expect(dock.props.railTopInset).toBeGreaterThan(layout.railTopInset + 48);
    }
  });
}

/** Mounted routes check bridge data and Back ownership, not actual UIKit pixel placement. */
test('Recent Records and saved recording detail use the shared Back anchor across route and geometry changes', async () => {
  AppState.currentState = 'active';
  jest.mocked(conversationExecutionNative).mockReturnValue(recentTestExecution);
  const controller = createNavigationController<AppNavigationRoute>('root');
  const view = await renderRecords(controller, recentRouteProps());
  try {
    await geometry(openGeometry);
    await fireEvent.press(await screen.findByTestId('records-recent-view-all'));
    await verifyBack(openGeometry);
    expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');

    await fireEvent.press(
      await screen.findByTestId('records-recent-source-synthetic-4'),
    );
    await screen.findByTestId('recording-review-layout');
    expect(controller.getSnapshot().currentRoute.name).toBe('recording-review');
    await verifyBack(openGeometry);
    await geometry(rotatedGeometry);
    await verifyBack(rotatedGeometry);

    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.name).toBe('recent-records');
    await verifyBack(rotatedGeometry);
    await fireEvent.press(screen.getByTestId('navigation-back'));
    expect(controller.getSnapshot().currentRoute.name).toBe('root');
  } finally {
    await view.unmount();
  }
});

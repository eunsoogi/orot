import { act, render, screen } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { NavigationActionBar } from '../NavigationActionBar';
import { createNavigationController } from '../navigationController';

test('waits for matching constrained native height and keeps the full primary label direct', async () => {
  const originalWindow = Dimensions.get('window');
  const originalScreen = Dimensions.get('screen');
  const control = globalThis as typeof globalThis & {
    __OROT_TEST_PAGE_METRICS__?: null;
  };
  control.__OROT_TEST_PAGE_METRICS__ = null;
  Dimensions.set({
    window: { ...originalWindow, width: 402 },
    screen: { ...originalScreen, width: 402 },
  });
  try {
    const controller = createNavigationController<'home' | 'details'>('home');
    controller.push('details');
    await render(
      <NavigationActionBar
        controller={controller}

        safeAreaHandledByParent
        pageActions={[
          {
            id: 'add',
            label: '증상 기록 추가',
            accessibilityLabel: '증상 기록 추가',
            testID: 'add',
            systemImageName: 'plus',
            onPress: jest.fn(),
          },
        ]}
      />,
    );
    const surface = () =>
      screen.getByTestId('navigation-bar-native-surface', {
        includeHiddenElements: true,
      });
    const naturalRevision = surface().props.pageMetricsRequest.revision;
    await act(async () =>
      surface().props.onPageMetrics({
        nativeEvent: {
          revision: naturalRevision,
          width: 386,
          widths: [76, 320, 140],
          heights: [80, 80, 80],
          category: 'xxxl',
        },
      }),
    );
    const request = surface().props.pageMetricsRequest;
    expect(request.revision).not.toBe(naturalRevision);
    expect(request.actions[1].layoutWidth).toBeLessThan(320);
    expect(screen.getByRole('progressbar')).toBeTruthy();
    await act(async () =>
      surface().props.onPageMetrics({
        nativeEvent: {
          revision: naturalRevision,
          width: 386,
          widths: [76, 320, 140],
          heights: [80, 80, 80],
          category: 'xxxl',
        },
      }),
    );
    expect(screen.getByRole('progressbar')).toBeTruthy();
    await act(async () =>
      surface().props.onPageMetrics({
        nativeEvent: {
          revision: request.revision,
          width: 386,
          widths: [
            76,
            request.actions[1].layoutWidth,
            request.actions[2].layoutWidth ?? 140,
          ],
          heights: [80, 160, 120],
          category: 'changed',
        },
      }),
    );
    expect(surface().props.pageMetricsRequest.revision).toBe(naturalRevision);
    await act(async () =>
      surface().props.onPageMetrics({
        nativeEvent: {
          revision: naturalRevision,
          width: 386,
          widths: [76, 320, 140],
          heights: [80, 80, 80],
          category: 'changed',
        },
      }),
    );
    const updatedRequest = surface().props.pageMetricsRequest;
    expect(screen.getByRole('progressbar')).toBeTruthy();
    await act(async () =>
      surface().props.onPageMetrics({
        nativeEvent: {
          revision: updatedRequest.revision,
          width: 386,
          widths: [
            76,
            updatedRequest.actions[1].layoutWidth,
            updatedRequest.actions[2].layoutWidth ?? 140,
          ],
          heights: [80, 160, 120],
          category: 'changed',
        },
      }),
    );
    expect(screen.getByTestId('add')).toBeTruthy();
    expect(screen.queryByTestId('navigation-page-action-overflow')).toBeNull();
    expect(
      screen.getByTestId('navigation-page-action-surface').props.bottomHeight,
    ).toBe(160);
  } finally {
    await act(async () =>
      Dimensions.set({ window: originalWindow, screen: originalScreen }),
    );
    delete control.__OROT_TEST_PAGE_METRICS__;
  }
});

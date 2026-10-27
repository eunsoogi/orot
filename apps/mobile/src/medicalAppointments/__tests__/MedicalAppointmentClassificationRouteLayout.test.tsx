import { act, screen } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import {
  columnsAxis,
  renderMedicalRoute,
  setWindowSize,
} from '../testSupport/MedicalAppointmentClassificationLayoutTestSupport';

jest.mock('react-native-safe-area-context', () => {
  const React = require('react') as typeof import('react');
  return {
    SafeAreaInsetsContext: React.createContext({
      top: 0,
      left: 0,
      right: 0,
      bottom: 34,
    }),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 34 }),
    SafeAreaProvider: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SafeAreaView: ({ children }: { children?: ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

test.each([
  { layout: 'compact', width: 390, fontScale: 1, direction: 'column' },
  { layout: 'expanded', width: 1000, fontScale: 1, direction: 'row' },
  {
    layout: 'narrow large-text',
    width: 760,
    fontScale: 1.5,
    direction: 'column',
  },
])(
  'keeps both appointment routes screen-owned in $layout space',
  async ({ width, fontScale, direction }) => {
    await setWindowSize(width, fontScale);
    const controller = await renderMedicalRoute();

    expect(columnsAxis()).toBe(direction);
    expect(
      screen.getByTestId('medical-appointment-review-scroll'),
    ).toBeTruthy();
    expect(
      screen.queryByTestId(
        `navigation-route-columns-${controller.getSnapshot().currentRoute.key}`,
      ),
    ).toBeNull();

    await act(async () => {
      controller.push('medical-manual');
    });
    const manualRouteKey = controller.getSnapshot().currentRoute.key;
    expect(screen.getByTestId('manual-route')).toBeTruthy();
    expect(
      screen.queryByTestId(`navigation-route-columns-${manualRouteKey}`),
    ).toBeNull();
  },
);

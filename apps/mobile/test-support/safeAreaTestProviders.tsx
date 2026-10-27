import type { ReactNode } from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

const rootMetrics = {
  frame: { x: 0, y: 0, width: 430, height: 800 },
  insets: { top: 0, right: 0, bottom: 0, left: 0 },
};

/** Models the app's root safe-area provider so nested native Modal providers can render in Jest. */
export function withRootSafeArea(children: ReactNode) {
  return (
    <SafeAreaProvider initialMetrics={rootMetrics}>{children}</SafeAreaProvider>
  );
}

export function renderWithRootSafeArea(children: ReactNode) {
  return render(withRootSafeArea(children));
}

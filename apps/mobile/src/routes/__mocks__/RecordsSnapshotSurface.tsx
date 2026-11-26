import { useLayoutEffect, type ReactNode } from 'react';
import { View, type ViewProps } from 'react-native';

export const hasRecordsNativeSnapshotSurface = true;
export function RecordsSnapshotSurface(
  props: ViewProps & {
    children: ReactNode;
    active: boolean;
    onBound(bound: boolean): void;
    neutral: ReactNode;
    terminal: boolean;
  },
) {
  const { active, onBound, ...view } = props;
  useLayoutEffect(() => {
    onBound(active);
  }, [active, onBound]);
  return (
    <View
      testID={view.testID}
      style={view.style}
      pointerEvents={view.pointerEvents}
      accessibilityElementsHidden={view.accessibilityElementsHidden}
      importantForAccessibility={view.importantForAccessibility}
    >
      {view.children}
    </View>
  );
}

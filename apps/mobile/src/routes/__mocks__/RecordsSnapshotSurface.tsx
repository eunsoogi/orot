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
  const {
    active,
    onBound,
    neutral: _neutral,
    terminal: _terminal,
    ...view
  } = props;
  useLayoutEffect(() => {
    onBound(active);
  }, [active, onBound]);
  return <View {...view} />;
}

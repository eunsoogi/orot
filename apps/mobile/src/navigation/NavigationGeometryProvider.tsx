import { createContext, useCallback, useContext, useState } from 'react';
import type { ReactNode } from 'react';
import {
  type NativeSyntheticEvent,
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type ViewProps,
} from 'react-native';
import {
  createNavigationGeometrySnapshot,
  type NavigationGeometryPayload,
  type NavigationGeometrySnapshot,
} from './navigationGeometry';

interface NavigationGeometryViewProps extends ViewProps {
  readonly onGeometryChange: (
    event: NativeSyntheticEvent<NavigationGeometryPayload>,
  ) => void;
}

const NativeNavigationGeometryView =
  Platform.OS === 'ios'
    ? requireNativeComponent<NavigationGeometryViewProps>(
        'NavigationGeometryView',
      )
    : null;

const NavigationGeometryContext =
  createContext<NavigationGeometrySnapshot | null>(null);

/** Shares native window geometry with routes while keeping the sensor outside keyboard resizing. */
export function NavigationGeometryProvider({
  children,
}: {
  readonly children: ReactNode;
}) {
  const [geometry, setGeometry] = useState<NavigationGeometrySnapshot | null>(
    null,
  );
  const onGeometryChange = useCallback(
    (event: NativeSyntheticEvent<NavigationGeometryPayload>) => {
      setGeometry(createNavigationGeometrySnapshot(event.nativeEvent));
    },
    [],
  );

  return (
    <NavigationGeometryContext.Provider value={geometry}>
      <View style={styles.fill}>
        {children}
        {NativeNavigationGeometryView ? (
          <NativeNavigationGeometryView
            collapsable={false}
            onGeometryChange={onGeometryChange}
            pointerEvents="none"
            style={styles.sensor}
            testID="navigation-window-geometry-sensor"
          />
        ) : null}
      </View>
    </NavigationGeometryContext.Provider>
  );
}

/** Returns the latest edge-to-edge window geometry, or null before the native sensor reports it. */
export function useNavigationGeometry(): NavigationGeometrySnapshot | null {
  return useContext(NavigationGeometryContext);
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  sensor: { ...StyleSheet.absoluteFill, zIndex: 1 },
});

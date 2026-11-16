import { createContext, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

const ComposerInset = createContext(0);
export const useFloatingComposerInset = () => useContext(ComposerInset);

/** Float over the transcript while reserving exactly the mounted controls' height for its final items. */
export function FloatingComposerSurface({
  children,
  composer,
}: {
  children: ReactNode;
  composer?: ReactNode;
}) {
  const [height, setHeight] = useState(0);
  return (
    <View
      style={styles.surface}
      testID="conversation-floating-composer-surface"
    >
      <ComposerInset.Provider value={composer ? height : 0}>
        {children}
      </ComposerInset.Provider>
      <View
        pointerEvents="box-none"
        style={styles.overlay}
        testID="conversation-floating-composer-overlay"
        onLayout={event => setHeight(event.nativeEvent.layout.height)}
      >
        {composer}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0, minWidth: 0 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

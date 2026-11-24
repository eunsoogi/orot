import { createContext, useContext, useState, type ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';

// Null is a mounted composer awaiting native layout; undefined is a standalone transcript.
const ComposerAnchor = createContext<number | null | undefined>(undefined);
export const useFloatingComposerAnchor = () => useContext(ComposerAnchor);
export const useFloatingComposerInset = () => useFloatingComposerAnchor() ?? 0;

/** Float over the transcript while reserving exactly the mounted controls' height for its final items. */
export function FloatingComposerSurface({
  children,
  composer,
}: {
  children: ReactNode;
  composer?: ReactNode;
}) {
  const [height, setHeight] = useState<number | null>(null);
  return (
    <View
      style={styles.surface}
      testID="conversation-floating-composer-surface"
    >
      <ComposerAnchor.Provider value={composer ? height : undefined}>
        {children}
      </ComposerAnchor.Provider>
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

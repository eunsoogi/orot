import {
  createContext,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ComposerFieldGeometry } from './ComposerField';
import {
  ConversationJumpHost,
  type ConversationJumpControl,
} from './HostedConversationJumpToLatest';
import { ConversationJumpToLatest } from './ConversationJumpToLatest';
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
  const [height, setHeight] = useState<number | null>(null);
  const [frameTop, setFrameTop] = useState<number | null>(null);
  const [fieldTop, setFieldTop] = useState<number | null>(null);
  const [occupied, setOccupied] = useState(false);
  const [jump, setJump] = useState<ConversationJumpControl | null>(null);
  const geometry = useMemo(
    () => ({ setFrameTop, setFieldTop, setOccupied }),
    [],
  );
  // A preceding native sibling (e.g. selected recording) consumes real space.
  // Only move into the composer's passive top padding, never onto occupied rows.
  const canUseField = !occupied && frameTop === 0 && fieldTop !== null;
  const anchor =
    height === null
      ? 0
      : height - (canUseField ? Math.min(height, Math.max(0, fieldTop)) : 0);
  return (
    <View
      style={styles.surface}
      testID="conversation-floating-composer-surface"
    >
      <ComposerInset.Provider value={composer ? (height ?? 0) : 0}>
        <ConversationJumpHost.Provider value={composer ? setJump : null}>
          {children}
        </ConversationJumpHost.Provider>
      </ComposerInset.Provider>
      <View
        pointerEvents="box-none"
        style={styles.overlay}
        testID="conversation-floating-composer-overlay"
        onLayout={event => setHeight(event.nativeEvent.layout.height)}
      >
        <ComposerFieldGeometry.Provider value={geometry}>
          {composer}
        </ComposerFieldGeometry.Provider>
      </View>
      {composer && jump ? (
        <ConversationJumpToLatest
          key={jump.sessionId}
          visible={jump.visible && height !== null}
          bottom={anchor}
          onPress={jump.onPress}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  surface: { flex: 1, minHeight: 0, minWidth: 0 },
  overlay: { position: 'absolute', left: 0, right: 0, bottom: 0 },
});

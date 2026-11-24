import {
  createContext,
  useContext,
  useLayoutEffect,
  type ReactNode,
} from 'react';
import { View, type ViewProps } from 'react-native';
import { styles } from './ConversationScreen.styles';

type Geometry = {
  readonly setFrameTop: (top: number | null) => void;
  readonly setFieldTop: (top: number | null) => void;
  readonly setOccupied: (occupied: boolean) => void;
};

export const ComposerFieldGeometry = createContext<Geometry | null>(null);

/** The frame itself is a direct native child of the floating host overlay. */
export function ComposerFrame({ onLayout, ...props }: ViewProps) {
  const geometry = useContext(ComposerFieldGeometry);
  useLayoutEffect(() => () => geometry?.setFrameTop(null), [geometry]);
  return (
    <View
      {...props}
      onLayout={event => {
        geometry?.setFrameTop(event.nativeEvent.layout.y);
        onLayout?.(event);
      }}
    />
  );
}

/** Report the painted field, distinct from the card's outer retention inset. */
export function ComposerField({
  children,
  occupied,
}: {
  readonly children: ReactNode;
  readonly occupied: boolean;
}) {
  const geometry = useContext(ComposerFieldGeometry);
  useLayoutEffect(() => {
    // The old field offset cannot be reused on a status-row transition.
    geometry?.setOccupied(occupied);
    return () => geometry?.setFieldTop(null);
  }, [geometry, occupied]);
  return (
    <View
      style={styles.composerField}
      testID="rag-conversation-composer-field"
      onLayout={event => geometry?.setFieldTop(event.nativeEvent.layout.y)}
    >
      {children}
    </View>
  );
}

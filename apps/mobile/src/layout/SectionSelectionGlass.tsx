import { useContext, useLayoutEffect, useRef, useState } from 'react';
import {
  Platform,
  requireNativeComponent,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type LayoutRectangle,
  type ViewProps,
} from 'react-native';
import { NavigationMotionContext } from '../navigation/NavigationMotionContext';
import { appColors } from './appColors';

type Target = LayoutRectangle & {
  readonly animated: boolean;
  readonly origin?: LayoutRectangle;
  readonly transition?: number;
};
type Props = ViewProps & { readonly selectionTarget?: Target };

const NativeSectionGlass =
  Platform.OS === 'ios'
    ? requireNativeComponent<Props>('SectionSelectionGlassView')
    : null;

function sameRect(a: LayoutRectangle | undefined, b: LayoutRectangle) {
  return (
    a &&
    a.x === b.x &&
    a.y === b.y &&
    a.width === b.width &&
    a.height === b.height
  );
}

/** Targets are the pressables' real local frames, including wrap and Dynamic Type. */
export function useSectionSelectionGlass<Id extends string>(selected: Id) {
  const reduceMotion = useContext(NavigationMotionContext);
  const [frames, setFrames] = useState<Partial<Record<Id, LayoutRectangle>>>(
    {},
  );
  const [target, setTarget] = useState<Target>();
  const previous = useRef<{ id: Id; rect?: LayoutRectangle } | undefined>(
    undefined,
  );
  const transition = useRef(0);
  const rect = frames[selected];

  useLayoutEffect(() => {
    const last = previous.current;
    previous.current = { id: selected, rect };
    if (!rect) {
      setTarget(undefined);
      return;
    }
    // A late measure on another tab must not turn the current slide into
    // a snap. A new selection uses the immediately previous tab in this row.
    const origin =
      !reduceMotion && last && last.id !== selected
        ? (frames[last.id] ?? last.rect)
        : undefined;
    if (origin && !sameRect(origin, rect)) {
      setTarget({
        ...rect,
        animated: true,
        origin,
        transition: ++transition.current,
      });
      return;
    }
    setTarget(current =>
      sameRect(current, rect) && (!reduceMotion || current?.animated === false)
        ? current
        : { ...rect, animated: false, origin: undefined },
    );
  }, [frames, rect, reduceMotion, selected]);

  return {
    target,
    onTabLayout(id: Id, event: LayoutChangeEvent) {
      const next = event.nativeEvent.layout;
      if (
        ![next.x, next.y, next.height, next.width].every(Number.isFinite) ||
        next.width <= 0 ||
        next.height <= 0
      )
        return;
      setFrames(current =>
        sameRect(current[id], next) ? current : { ...current, [id]: next },
      );
    },
  };
}

/** Exactly one decorative, persistent material host; hit targets remain React-owned. */
export function SectionSelectionGlass({
  target,
  testID,
}: {
  readonly target?: Target;
  readonly testID: string;
}) {
  const decorations = {
    testID,
    pointerEvents: 'none' as const,
    accessible: false,
    accessibilityElementsHidden: true,
    importantForAccessibility: 'no-hide-descendants' as const,
  };
  if (NativeSectionGlass) {
    return (
      <NativeSectionGlass
        {...decorations}
        selectionTarget={target}
        style={StyleSheet.absoluteFill}
      />
    );
  }
  return (
    <View
      {...decorations}
      style={[
        styles.fallback,
        target && {
          left: target.x,
          top: target.y,
          width: target.width,
          height: target.height,
          borderRadius: Math.min(target.width, target.height) / 2,
        },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  fallback: { position: 'absolute', backgroundColor: appColors.surface },
});

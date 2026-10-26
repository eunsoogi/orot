import { useContext } from 'react';
import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { ROOT_TAB_SAFE_AREA_TRANSLATION } from './navigationLayout';

/** Reclaims only the original home-area overlap; the keyboard keeps its own usable height. */
export function NavigationSurfacePosition({
  children,
  reclaimRootTabInset,
  style,
}: {
  readonly children: ReactNode;
  readonly reclaimRootTabInset: boolean;
  readonly style?: StyleProp<ViewStyle>;
}) {
  const insets = useContext(SafeAreaInsetsContext);
  if (reclaimRootTabInset && insets == null) {
    throw new Error(
      'No safe area value available. Make sure you are rendering <SafeAreaProvider> at the top of your app.',
    );
  }
  const positionStyle = reclaimRootTabInset
    ? {
        transform: [
          {
            translateY: Math.min(
              ROOT_TAB_SAFE_AREA_TRANSLATION,
              insets?.bottom ?? 0,
            ),
          },
        ],
      }
    : undefined;
  const wrapperStyle =
    style === undefined
      ? positionStyle
      : positionStyle === undefined
        ? style
        : [style, positionStyle];
  return (
    <View pointerEvents="box-none" style={wrapperStyle}>
      {children}
    </View>
  );
}

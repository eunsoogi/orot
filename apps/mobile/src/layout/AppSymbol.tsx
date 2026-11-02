import { requireNativeComponent } from 'react-native';
import type { ColorValue, ViewProps } from 'react-native';
import { appColors } from './appColors';
import { COMPACT_APP_SYMBOL_POINT_SIZE } from './iconSizing';

interface SymbolProps extends ViewProps {
  readonly symbolName: string;
  readonly pointSize: number;
  readonly tintColor: ColorValue;
}
const NativeSymbol = requireNativeComponent<SymbolProps>('AppSymbolView');

/** Decorative body symbols use the compact accent scale; their parent owns touch and accessibility. */
export function AppSymbol({
  name,
  size = COMPACT_APP_SYMBOL_POINT_SIZE,
  color = appColors.primary,
}: {
  readonly name: string;
  readonly size?: number;
  readonly color?: ColorValue;
}) {
  return (
    <NativeSymbol
      symbolName={name}
      pointSize={size}
      tintColor={color}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}
    />
  );
}

import { requireNativeComponent } from 'react-native';
import type { ColorValue, ViewProps } from 'react-native';
import { appColors } from './appColors';

interface SymbolProps extends ViewProps {
  readonly symbolName: string;
  readonly pointSize: number;
  readonly tintColor: ColorValue;
}
const NativeSymbol = requireNativeComponent<SymbolProps>('AppSymbolView');

/** Decorative system symbols inherit their meaning from the enclosing accessible control. */
export function AppSymbol({
  name,
  size = 20,
  color = appColors.secondary,
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

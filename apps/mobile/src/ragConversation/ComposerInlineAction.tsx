import { createContext } from 'react';
import type { ComponentProps } from 'react';
import { Pressable } from 'react-native';
import { AppSymbol } from '../layout/AppSymbol';
import { appColors } from '../layout/appColors';
import type { GlassIconButton } from '../layout/GlassIconButton';

/** Only descendants of the composer share its backing glass. */
export const ComposerInlineActionContext = createContext(false);

/** A 44-point action on the existing glass, not another material or overlay. */
export function ComposerInlineAction({
  symbolName,
  accessibilityLabel,
  accessibilityHint,
  accessibilityState,
  onPress,
  style,
  testID,
  disabled = false,
}: ComponentProps<typeof GlassIconButton>) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ ...accessibilityState, disabled }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress?.();
      }}
      style={style}
      testID={testID}
    >
      <AppSymbol
        name={symbolName}
        color={disabled ? appColors.secondary : appColors.text}
      />
    </Pressable>
  );
}

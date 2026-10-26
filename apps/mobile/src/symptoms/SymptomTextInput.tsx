import { createContext, useContext, useEffect, useRef } from 'react';
import { TextInput } from 'react-native';
import type { TextInputInstance, TextInputProps } from 'react-native';
import type useSymptomFocusReveal from './useSymptomFocusReveal';

export const SymptomFocusRevealContext = createContext<ReturnType<
  typeof useSymptomFocusReveal
> | null>(null);

/** Registers editable symptom fields while retaining their native role, value, accessory, and caller events. */
export default function SymptomTextInput({
  onFocus,
  onBlur,
  onLayout,
  ...props
}: TextInputProps) {
  const input = useRef<TextInputInstance>(null);
  const reveal = useContext(SymptomFocusRevealContext);
  const blurInput = reveal?.blurInput;
  useEffect(() => {
    const mountedInput = input.current;
    return () => blurInput?.(mountedInput);
  }, [blurInput]);
  return (
    <TextInput
      {...props}
      ref={input}
      onFocus={event => {
        reveal?.focusInput(input.current);
        onFocus?.(event);
      }}
      onBlur={event => {
        reveal?.blurInput(input.current);
        onBlur?.(event);
      }}
      onLayout={event => {
        reveal?.revealFocused();
        onLayout?.(event);
      }}
    />
  );
}

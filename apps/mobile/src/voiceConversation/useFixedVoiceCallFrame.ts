import { useState } from 'react';
import {
  StyleSheet,
  useWindowDimensions,
  type LayoutChangeEvent,
} from 'react-native';

/** The fixed shell fits the existing transcript by compacting the surrounding
 * chrome from the modal's safe height, not a guessed device model or orientation. */
export function useFixedVoiceCallFrame(active: boolean) {
  const { height, fontScale, width } = useWindowDimensions();
  const [frame, setFrame] = useState<{ window: string; height: number }>();
  const windowKey = width + ':' + height;
  const safeHeight = frame?.window === windowKey ? frame.height : height;
  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => {
    const nextHeight = nativeEvent.layout.height;
    if (nextHeight <= 0) return;
    setFrame(previous =>
      previous?.window === windowKey && previous.height === nextHeight
        ? previous
        : { window: windowKey, height: nextHeight },
    );
  };
  const compact = active && (safeHeight < 680 || fontScale >= 1.5);
  return {
    compact,
    onLayout,
    contentStyle: [
      fixedVoiceCallStyles.fixedContent,
      compact && fixedVoiceCallStyles.compactContent,
    ],
    focusProps: active
      ? {
          style: [
            fixedVoiceCallStyles.focus,
            compact && fixedVoiceCallStyles.compactFocus,
          ],
        }
      : {},
  };
}

/** Layout-only adjustments; transcript sizing and behavior stay with its own viewport. */
export const fixedVoiceCallStyles = StyleSheet.create({
  fixedContent: { flex: 1, padding: 24, gap: 24 },
  compactContent: { padding: 12, gap: 8 },
  compactCenter: { minHeight: 0, gap: 8 },
  // Short safe height tightens the stack, never changes its visual or reading order.
  focus: {
    width: '100%',
    flexShrink: 0,
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
  },
  compactFocus: { gap: 8 },
  compactActions: { gap: 12 },
  compactAction: { gap: 4 },
  compactDisc: { width: 56, height: 56, borderRadius: 28 },
});

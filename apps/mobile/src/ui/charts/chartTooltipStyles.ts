import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';

export const chartTooltipStyles = StyleSheet.create({
  callout: {
    position: 'absolute',
    zIndex: 1,
    padding: 8,
    borderRadius: 8,
    backgroundColor: appColors.background,
    borderWidth: 1,
    borderColor: appColors.border,
  },
  text: { color: appColors.text, flexShrink: 1 },
});

export function chartTooltipFrameStyle(
  width: number,
  host: { x: number; y: number },
  position: { x: number; y: number } | undefined,
) {
  return {
    width,
    opacity: position ? 1 : 0,
    left: position ? position.x - host.x : 0,
    top: position ? position.y - host.y : 0,
  };
}

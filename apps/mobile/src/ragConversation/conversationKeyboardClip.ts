import type { NavigationGeometryRect } from '../navigation/navigationGeometry';

type Panel = {
  readonly top: number;
  readonly height: number;
  readonly leading: number;
  readonly activityWidth: number;
  readonly gap: number;
  readonly transcriptWidth: number;
};

/** Use the keyboard top as a ceiling, not a second inset over an already resized host. */
export function clipConversationToKeyboard<T extends Panel>(
  panel: T,
  host: Pick<NavigationGeometryRect, 'x' | 'y'>,
  keyboard?: NavigationGeometryRect,
): T {
  if (!keyboard || keyboard.height <= 0 || keyboard.width <= 0) return panel;

  const left = host.x + panel.leading + panel.activityWidth + panel.gap;
  const right = left + panel.transcriptWidth;
  const top = host.y + panel.top;
  const bottom = top + panel.height;
  if (
    keyboard.x >= right ||
    keyboard.x + keyboard.width <= left ||
    keyboard.y >= bottom ||
    keyboard.y + keyboard.height <= top
  )
    return panel;

  return { ...panel, height: Math.max(0, keyboard.y - top) };
}

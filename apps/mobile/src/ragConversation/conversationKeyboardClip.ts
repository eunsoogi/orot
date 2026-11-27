import { useEffect, useRef } from 'react';
import { NativeModules } from 'react-native';
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

/** Observe the committed routed clip decision with no coordinates or identity. */
export function useReportConversationKeyboardClip(
  routed: boolean,
  panel: Panel,
  plan: Panel,
  hostTop: number,
  keyboard: NavigationGeometryRect | undefined,
) {
  const clip = !keyboard
    ? 'no-native-frame'
    : plan.height <= 0
      ? 'collapsed'
      : plan !== panel
        ? 'clipped'
        : hostTop + panel.top + panel.height <= keyboard.y
          ? 'already-above'
          : 'disjoint';
  const last = useRef<typeof clip | undefined>(undefined);
  const count = useRef(0);
  useEffect(() => {
    if (!routed || last.current === clip || count.current >= 12) return;
    try {
      const sink = NativeModules.OrotProviderDiagnostics;
      if (sink?.conversationKeyboardEnabled !== true) return;
      last.current = clip;
      count.current++;
      sink.report('navigation', 'conversation_keyboard_clip', clip);
    } catch {
      // An unavailable diagnostic bridge must not affect measured layout.
    }
  }, [clip, routed]);
}

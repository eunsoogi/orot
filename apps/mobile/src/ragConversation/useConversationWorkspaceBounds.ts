import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import { AppState, useWindowDimensions } from 'react-native';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import { useNavigationContentFrame } from '../navigation/navigationContentFrame';
import { observeNavigationTest } from '../navigation/navigationTestObservation';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import { conversationWorkspaceOcclusion } from './conversationWorkspaceOcclusion';
import { conversationHingeLayout } from './conversationHingeLayout';

/** Measure in window coordinates: onLayout.x belongs to a different coordinate space. */
export function useConversationWorkspaceBounds(routeKey?: string) {
  const geometry = useNavigationGeometry();
  const occlusion = useNavigationOcclusion();
  const shared = useNavigationContentFrame();
  const { fontScale, width, height } = useWindowDimensions();
  const ref = useRef<HostInstance | null>(null);
  const [bounds, setBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
  } | null>(null);
  const measurementSequence = useRef(0);
  const appState = useRef(AppState.currentState);
  const measure = useCallback(() => {
    if (appState.current === 'background' || appState.current === 'inactive')
      return;
    const sequence = ++measurementSequence.current;
    ref.current?.measureInWindow((x, y, measuredWidth, measuredHeight) => {
      // A later layout owns its measurement even when bridge callbacks complete out of order.
      if (sequence !== measurementSequence.current) return;
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(measuredWidth) ||
        measuredWidth <= 0 ||
        !Number.isFinite(y) ||
        !Number.isFinite(measuredHeight) ||
        measuredHeight <= 0
      )
        return;
      setBounds(previous =>
        previous &&
        Math.abs(previous.x - x) < 0.5 &&
        Math.abs(previous.width - measuredWidth) < 0.5 &&
        Math.abs(previous.y - y) < 0.5 &&
        Math.abs(previous.height - measuredHeight) < 0.5
          ? previous
          : { x, y, width: measuredWidth, height: measuredHeight },
      );
    });
  }, []);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      appState.current = state;
      // Suspended geometry cannot overwrite the resumed host. A foreground transition
      // must remeasure even when window dimensions and native snapshot are unchanged.
      measurementSequence.current += 1;
      if (state === 'active') measure();
    });
    return () => {
      subscription.remove();
      // Ignore an in-flight native callback after this host has unmounted.
      measurementSequence.current += 1;
    };
  }, [measure]);
  useEffect(measure, [measure, geometry, shared, width, height, fontScale]);
  const fallback = shared?.availableContentFrame ?? geometry?.safeAreaFrame;
  const measuredBounds = bounds ?? {
    x: fallback?.x ?? 0,
    y: fallback?.y ?? 0,
    width: fallback?.width ?? width,
    height: fallback?.height ?? height,
  };
  // The shell contracts before asynchronous measureInWindow callbacks return. Never
  // let the last measured host carry a floating composer below its current viewport.
  const sharedBottom = shared
    ? shared.availableContentFrame.y + shared.availableContentFrame.height
    : Infinity;
  const hostBounds = {
    ...measuredBounds,
    height: Math.max(
      0,
      Math.min(measuredBounds.height, sharedBottom - measuredBounds.y),
    ),
  };
  const plan = conversationHingeLayout(
    geometry,
    hostBounds,
    fontScale,
    shared !== null,
  );
  const workspaceOcclusion = conversationWorkspaceOcclusion(
    occlusion,
    hostBounds.height,
    plan,
    shared && geometry
      ? Math.max(
          0,
          hostBounds.y +
            plan.top +
            plan.height -
            (geometry.safeAreaFrame.y + geometry.safeAreaFrame.height),
        )
      : 0,
  );
  useEffect(() => {
    if (routeKey)
      observeNavigationTest('adaptive-columns-layout', {
        routeKey,
        active: true,
        width: String(plan.activityWidth + plan.gap + plan.transcriptWidth),
        columns: plan.visible ? '2' : '1',
        fontScale: String(fontScale),
      });
  }, [
    routeKey,
    plan.activityWidth,
    plan.gap,
    plan.transcriptWidth,
    plan.visible,
    fontScale,
  ]);
  return { ref, measure, plan, workspaceOcclusion };
}

import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import { useWindowDimensions } from 'react-native';
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
  const measure = useCallback(() => {
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
  useEffect(
    () => () => {
      // Ignore an in-flight native callback after this host has unmounted.
      measurementSequence.current += 1;
    },
    [],
  );
  useEffect(measure, [measure, geometry, shared, width, height, fontScale]);
  const fallback = shared?.availableContentFrame ?? geometry?.safeAreaFrame;
  const hostBounds = bounds ?? {
    x: fallback?.x ?? 0,
    y: fallback?.y ?? 0,
    width: fallback?.width ?? width,
    height: fallback?.height ?? height,
  };
  const plan = conversationHingeLayout(geometry, hostBounds, fontScale);
  const workspaceOcclusion = conversationWorkspaceOcclusion(
    occlusion,
    hostBounds.height,
    plan,
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

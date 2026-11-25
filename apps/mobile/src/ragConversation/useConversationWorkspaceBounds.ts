import { useCallback, useEffect, useRef, useState } from 'react';
import type { HostInstance } from 'react-native';
import { AppState, useWindowDimensions } from 'react-native';
import { useNavigationGeometry } from '../navigation/NavigationGeometryProvider';
import { useNavigationContentFrame } from '../navigation/navigationContentFrame';
import { observeNavigationTest } from '../navigation/navigationTestObservation';
import { useNavigationOcclusion } from '../navigation/useNavigationContentInset';
import { conversationWorkspaceOcclusion } from './conversationWorkspaceOcclusion';
import { clipConversationToKeyboard } from './conversationKeyboardClip';
import { conversationHingeLayout } from './conversationHingeLayout';
import { conversationProfileVisualLift } from './conversationWorkspaceLayout';

type Limits = { readonly width: number; readonly height: number };

function positiveLimit(windowSize: number, routeSize?: number): number {
  const window =
    windowSize > 0 && Number.isFinite(windowSize) ? windowSize : Infinity;
  return routeSize !== undefined && routeSize > 0 && Number.isFinite(routeSize)
    ? Math.min(window, routeSize)
    : window;
}

function contractedSize(previous: number, current: number, sample: number) {
  return current < previous && sample > current ? current : undefined;
}

/** Measure in window coordinates: onLayout.x belongs to a different coordinate space. */
export function useConversationWorkspaceBounds(routeKey?: string) {
  const geometry = useNavigationGeometry();
  const occlusion = useNavigationOcclusion();
  const shared = useNavigationContentFrame();
  const { fontScale, width, height } = useWindowDimensions();
  const routeFrame = shared?.availableContentFrame;
  const limits = {
    width: positiveLimit(width, routeFrame?.width),
    height: positiveLimit(height, routeFrame?.height),
  };
  const latestLimits = useRef<Limits>(limits);
  latestLimits.current = limits;
  const ref = useRef<HostInstance | null>(null);
  const [bounds, setBounds] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    limits: Limits;
  } | null>(null);
  const measurementSequence = useRef(0);
  const appState = useRef(AppState.currentState);
  const measure = useCallback(() => {
    if (appState.current === 'background' || appState.current === 'inactive')
      return;
    const sequence = ++measurementSequence.current;
    const requestedLimits = latestLimits.current;
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
      setBounds(previous => {
        // A bridge callback can still sample the old host before native reflow.
        if (
          previous &&
          (contractedSize(
            previous.limits.width,
            requestedLimits.width,
            measuredWidth,
          ) !== undefined ||
            contractedSize(
              previous.limits.height,
              requestedLimits.height,
              measuredHeight,
            ) !== undefined)
        )
          return previous;
        return previous &&
          previous.limits.width === requestedLimits.width &&
          previous.limits.height === requestedLimits.height &&
          Math.abs(previous.x - x) < 0.5 &&
          Math.abs(previous.width - measuredWidth) < 0.5 &&
          Math.abs(previous.y - y) < 0.5 &&
          Math.abs(previous.height - measuredHeight) < 0.5
          ? previous
          : {
              x,
              y,
              width: measuredWidth,
              height: measuredHeight,
              limits: requestedLimits,
            };
      });
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
    // AppState does not replay a transition between render and subscription.
    // Reconcile the singleton before the following measurement effect runs.
    if (appState.current !== AppState.currentState) {
      appState.current = AppState.currentState;
      measurementSequence.current += 1;
    }
    return () => {
      subscription.remove();
      // Ignore an in-flight native callback after this host has unmounted.
      measurementSequence.current += 1;
    };
  }, [measure]);
  useEffect(measure, [measure, geometry, shared, width, height, fontScale]);
  const fallback = routeFrame ?? geometry?.safeAreaFrame;
  // A positive old measurement is useful only inside today's known window/route.
  // Keep the same host and rows while waiting for the authoritative native sample.
  const limitedWidth =
    bounds && contractedSize(bounds.limits.width, limits.width, bounds.width);
  const limitedHeight =
    bounds &&
    contractedSize(bounds.limits.height, limits.height, bounds.height);
  const hostBounds = bounds
    ? {
        x:
          limitedWidth == null
            ? bounds.x
            : (routeFrame?.x ?? geometry?.windowBounds?.x ?? 0),
        y:
          limitedHeight == null
            ? bounds.y
            : (routeFrame?.y ?? geometry?.windowBounds?.y ?? 0),
        width: limitedWidth ?? bounds.width,
        height: limitedHeight ?? bounds.height,
      }
    : {
        x: fallback?.x ?? 0,
        y: fallback?.y ?? 0,
        width: Math.min(fallback?.width ?? width, limits.width),
        height: Math.min(fallback?.height ?? height, limits.height),
      };
  const plan = clipConversationToKeyboard(
    conversationHingeLayout(geometry, hostBounds, fontScale, shared !== null),
    hostBounds,
    geometry?.dockedKeyboardFrame,
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
  const profileVisualLift = conversationProfileVisualLift(geometry, shared, {
    x: hostBounds.x + plan.leading,
    y: hostBounds.y + plan.top,
    width: plan.visible ? plan.activityWidth : plan.transcriptWidth,
  });
  return { ref, measure, plan, profileVisualLift, workspaceOcclusion };
}

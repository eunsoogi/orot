import type { NavigationGeometrySnapshot } from '../navigation/navigationGeometry';
import { resolveAdaptiveColumns } from '../layout/adaptiveColumnsPlan';
import { conversationWorkspaceLayout } from './conversationWorkspaceLayout';

/** Clip native window regions to this host before translating them into local panel offsets. */
export function conversationHingeLayout(
  geometry: NavigationGeometrySnapshot | null,
  bounds: { x: number; width: number; y?: number; height?: number },
  fontScale: number,
) {
  const activeDivision = Boolean(
    geometry?.reservedRegions.some(
      region => region.isActive && region.kind === 'division',
    ),
  );
  const zero = { top: 0, right: 0, bottom: 0, left: 0 };
  const native = resolveAdaptiveColumns({
    windowWidth: bounds.width,
    fontScale,
    measuredBounds: bounds,
    systemInsets: zero,
    viewportInsets: zero,
    safeAreaFrame: geometry?.safeAreaFrame,
    usableRegions: geometry?.usableRegions,
    hasNativeDivision: activeDivision,
    hasNativeOcclusion: geometry?.reservedRegions.some(
      region => region.isActive && region.kind === 'occlusion',
    ),
    hasSecondary: geometry?.hasHinge === true && activeDivision,
  });
  const y = bounds.y ?? geometry?.safeAreaFrame.y ?? 0;
  const height = bounds.height ?? geometry?.safeAreaFrame.height ?? 0;
  const left = bounds.x + native.leadingInset;
  const right =
    left +
    native.primaryWidth +
    (native.columns === 2 ? native.columnGap + native.secondaryWidth : 0);
  // Use a common safe vertical overlap; a top corner occlusion must not cover chat controls.
  const intersecting =
    geometry?.usableRegions.filter(
      region => region.x < right && region.x + region.width > left,
    ) ?? [];
  const tall = intersecting.filter(
    region => region.height >= (geometry?.safeAreaFrame.height ?? 0) * 0.6,
  );
  const candidates = tall.length ? tall : intersecting;
  const regions =
    native.columns === 2
      ? candidates
      : candidates
          .slice()
          .sort((a, b) => b.width - a.width || a.x - b.x || a.y - b.y)
          .slice(0, 1);
  const top = Math.max(y, ...regions.map(region => region.y));
  const bottom = Math.min(
    y + height,
    ...regions.map(region => region.y + region.height),
  );
  const vertical = {
    top: Math.max(0, top - y),
    height: Math.max(0, bottom - top),
  };
  if (native.columns === 2) {
    return {
      ...vertical,
      visible: true,
      leading: native.leadingInset,
      activityWidth: native.primaryWidth,
      gap: native.columnGap,
      transcriptWidth: native.secondaryWidth,
    };
  }
  // Ordinary phones and unsafe/narrow regions remain one accessible panel.
  const open = conversationWorkspaceLayout(
    geometry?.hasHinge === true && !activeDivision,
    native.primaryWidth,
    fontScale,
  );
  return {
    ...vertical,
    visible: open.visible,
    leading: native.leadingInset,
    activityWidth: open.activityWidth,
    gap: 0,
    transcriptWidth: native.primaryWidth - open.activityWidth,
  };
}

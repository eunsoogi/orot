import type { NavigationGeometryPayload } from '../navigationGeometry';

// Native 26d3ab16 manual diagnostics, 2026-10-27: initial Open sensor event
// atMs 1793089419044 and final rotated event 1793089860221. These geometry-only
// inputs reproduce a policy defect; the separate flagged launch is not original
// FeatureEntry execution evidence. Inactive regions must never carve panels.
export const openGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 951, height: 669 },
  safeAreaInsets: { top: 0, right: 84, bottom: 34, left: 0 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'ID()',
      kind: 'division',
      frame: { x: 455.5, y: 0, width: 40, height: 669 },
      margins: { top: 0, right: 20, bottom: 0, left: 20 },
      isActive: false,
    },
    {
      id: 'ID()',
      kind: 'occlusion',
      frame: { x: 677.3333333333334, y: 21, width: 58, height: 37 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: false,
    },
    {
      id: 'ID()',
      kind: 'occlusion',
      frame: { x: 867, y: 0, width: 84, height: 124 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
  ],
};

export const rotatedGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 669, height: 951 },
  safeAreaInsets: { top: 82, right: 0, bottom: 34, left: 0 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'ID()',
      kind: 'division',
      frame: { x: 0, y: 455.5, width: 669, height: 40 },
      margins: { top: 20, right: 0, bottom: 20, left: 0 },
      isActive: false,
    },
    {
      id: 'ID()',
      kind: 'occlusion',
      frame: { x: 611, y: 677.3333333333334, width: 37, height: 58 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: false,
    },
    {
      id: 'ID()',
      kind: 'occlusion',
      frame: { x: 525, y: 0, width: 144, height: 82 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
  ],
};

// Synthetic active seam for retained-route and consumed-inset regression checks.
export const dividedGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 1000, height: 900 },
  safeAreaInsets: { top: 40, right: 22, bottom: 30, left: 14 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'display-division',
      kind: 'division',
      frame: { x: 450, y: 0, width: 40, height: 900 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
    {
      id: 'top-indicator',
      kind: 'occlusion',
      frame: { x: 760, y: 0, width: 100, height: 80 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
      isActive: true,
    },
  ],
};

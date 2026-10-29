import type { NavigationGeometryPayload } from '../navigationGeometry';

// Public UIKit observation from app be920f58 on iOS 27.1, 2026-10-29.
// The screenshot independently places Orot left of the system divider. These
// frames are window points, not coordinates derived from a generated mockup.
export const leftSplitGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 469, height: 669 },
  safeAreaInsets: { top: 0, right: 0, bottom: 34, left: 0 },
  reservedRegionsSupported: true,
  hasHinge: true,
  reservedRegions: [
    {
      id: 'ID()',
      kind: 'division',
      isActive: false,
      frame: { x: 455.5, y: 0, width: 13.5, height: 669 },
      margins: { top: 0, right: 20, bottom: 0, left: 20 },
    },
    {
      id: 'ID()',
      kind: 'occlusion',
      isActive: false,
      frame: { x: 215.66666666666666, y: 611, width: 58, height: 37 },
      margins: { top: 0, right: 0, bottom: 0, left: 0 },
    },
  ],
};

import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';

export const medicalDocumentReviewInsets = {
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
};

/** Models two usable display regions and the reserved right navigation lane. */
export const medicalDocumentReviewDuoGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 1000, height: 900 },
  safeAreaInsets: { top: 40, right: 22, bottom: 30, left: 14 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'display-division',
      kind: 'division',
      frame: { x: 450, y: 0, width: 40, height: 900 },
      margins: medicalDocumentReviewInsets,
      isActive: true,
    },
    {
      id: 'right-navigation-lane',
      kind: 'occlusion',
      frame: { x: 918, y: 0, width: 60, height: 900 },
      margins: medicalDocumentReviewInsets,
      isActive: true,
    },
  ],
};

export const medicalDocumentReviewCompactGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 320, height: 900 },
  safeAreaInsets: medicalDocumentReviewInsets,
  reservedRegionsSupported: false,
  reservedRegions: [],
};

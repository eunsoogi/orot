import type { EvidenceSpan } from '@orot/domain';
import type { NavigationGeometryPayload } from '../../navigation/navigationGeometry';
import type { SavedMedicalDocument } from '../medicalDocumentImportService';

const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

export const sourceDetailDuoGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 1000, height: 900 },
  safeAreaInsets: { top: 40, right: 22, bottom: 30, left: 14 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'display-division',
      kind: 'division',
      frame: { x: 450, y: 0, width: 40, height: 900 },
      margins: noInsets,
      isActive: true,
    },
    {
      id: 'right-navigation-lane',
      kind: 'occlusion',
      frame: { x: 918, y: 0, width: 60, height: 900 },
      margins: noInsets,
      isActive: true,
    },
  ],
};

export const sourceDetailNarrowSplitGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 620, height: 900 },
  safeAreaInsets: { top: 20, right: 10, bottom: 20, left: 10 },
  reservedRegionsSupported: true,
  reservedRegions: [
    {
      id: 'narrow-display-division',
      kind: 'division',
      frame: { x: 290, y: 0, width: 40, height: 900 },
      margins: noInsets,
      isActive: true,
    },
    {
      id: 'narrow-right-navigation-lane',
      kind: 'occlusion',
      frame: { x: 565, y: 0, width: 45, height: 900 },
      margins: noInsets,
      isActive: true,
    },
  ],
};

export const sourceDetailCompactGeometry: NavigationGeometryPayload = {
  windowBounds: { x: 0, y: 0, width: 320, height: 900 },
  safeAreaInsets: noInsets,
  reservedRegionsSupported: false,
  reservedRegions: [],
};

function evidenceSpan(
  id: string,
  text: string,
  location: Pick<EvidenceSpan, 'pageNumber' | 'locator'> = {},
): EvidenceSpan {
  return {
    id,
    sourceRecordId: 'document-saved',
    text,
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: ['document-saved'] },
    reviewState: { status: 'unreviewed' },
    ...location,
  };
}

/** Synthetic saved spans cover locator forms without asserting retained original bytes. */
export const sourceDetailEvidenceSpans: readonly EvidenceSpan[] = [
  evidenceSpan('saved-span-range', 'Synthetic saved page text', {
    pageNumber: 2,
    locator: {
      kind: 'document_range',
      pageNumber: 2,
      startOffset: 0,
      endOffset: 25,
    },
  }),
  evidenceSpan('saved-span-text-range', 'Synthetic range text', {
    locator: { kind: 'text_range', startOffset: 2, endOffset: 10 },
  }),
  evidenceSpan('saved-span-page-only', 'Synthetic page-only text', {
    pageNumber: 4,
  }),
  evidenceSpan('saved-span-no-location', 'Synthetic text without a locator'),
];

export function savedSourceDocument(
  evidenceSpans: SavedMedicalDocument['evidenceSpans'] = sourceDetailEvidenceSpans,
): SavedMedicalDocument {
  return {
    id: 'document-saved',
    sourceKind: 'medical_document',
    title: 'Synthetic saved source.pdf',
    ingestedAt: '2026-10-01T10:00:00.000Z',
    provenance: { origin: 'imported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
    evidenceSpans,
  };
}

/** Shares the photo bridge payload and its recoverable native error codes. */
export const medicalDocumentOriginalPhotoErrorCodes = [
  'ORIGINAL_MISSING',
  'ORIGINAL_UNAVAILABLE',
  'UNSUPPORTED_ORIGINAL',
  'CORRUPT_ORIGINAL',
] as const;

export type MedicalDocumentOriginalPhotoErrorCode =
  (typeof medicalDocumentOriginalPhotoErrorCodes)[number];

export interface StoredMedicalDocumentPhoto {
  readonly sourceId: string;
  readonly mimeType: 'image/jpeg' | 'image/heic' | 'image/png';
  readonly base64Data: string;
}

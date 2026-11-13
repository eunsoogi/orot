import { medicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import { MedicalDocumentImportError } from '../medicalDocuments/medicalDocumentNativeBridge';
import type { MedicalDocumentImportService } from '../medicalDocuments/medicalDocumentImportService';
import {
  canUseMedicalDocumentGeneration,
  currentMedicalDocumentGeneration,
} from '../medicalDocuments/medicalDocumentLifecycle';
import { createConversationPhotoDrafts } from './conversationPhotoDraft';

/** Reuses the selected-only picker and protected original lifecycle without committing a document. */
export function createConversationPhotoImport(
  service: Pick<
    MedicalDocumentImportService,
    'selectDocument' | 'discardDocument'
  > = medicalDocumentImportService,
) {
  return createConversationPhotoDrafts({
    pick: () => service.selectDocument('photos'),
    discard: document => service.discardDocument(document),
    captureValidity: () => {
      const generation = currentMedicalDocumentGeneration();
      return () => canUseMedicalDocumentGeneration(generation);
    },
    errorReason: error => {
      if (!(error instanceof MedicalDocumentImportError)) return undefined;
      switch (error.code) {
        case 'UNSUPPORTED_DOCUMENT':
          return 'unsupported';
        case 'EMPTY_DOCUMENT':
          return 'empty';
        case 'FILE_PROTECTION_UNAVAILABLE':
          return 'protection';
        case 'NATIVE_UNAVAILABLE':
          return 'unavailable';
        default:
          return undefined;
      }
    },
  });
}

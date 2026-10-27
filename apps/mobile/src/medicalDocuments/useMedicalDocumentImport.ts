import { useCallback, useEffect, useState } from 'react';
import { t } from '../i18n';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { medicalDocumentImportService } from './medicalDocumentImportService';
import type {
  MedicalDocumentImportService,
  MedicalDocumentSourceRecord,
  SavedMedicalDocument,
} from './medicalDocumentImportService';
import { MedicalDocumentImportError } from './medicalDocumentNativeBridge';
import type { StagedMedicalDocument } from './medicalDocumentNativeBridge';

type ImportActivity = 'selecting' | 'saving' | 'discarding' | null;

function errorMessage(error: unknown): string {
  if (!(error instanceof MedicalDocumentImportError)) {
    return t('medicalDocument.error.importFailed');
  }
  switch (error.code) {
    case 'SCANNED_PDF_UNSUPPORTED':
      return t('medicalDocument.error.scannedPdfUnsupported');
    case 'UNSUPPORTED_DOCUMENT':
      return t('medicalDocument.error.unsupportedDocument');
    case 'UNSUPPORTED_TEXT_ENCODING':
      return t('medicalDocument.error.unsupportedTextEncoding');
    case 'EMPTY_DOCUMENT':
      return t('medicalDocument.error.emptyDocument');
    case 'FILE_PROTECTION_UNAVAILABLE':
      return t('medicalDocument.error.fileProtectionUnavailable');
    case 'CLEANUP_FAILED':
      return t('medicalDocument.error.cleanupFailed');
    case 'NATIVE_UNAVAILABLE':
    case 'IMPORT_FAILED':
      return t('medicalDocument.error.importFailed');
  }
}

/** Owns the staged import and prevents navigation until the user saves or discards it. */
export function useMedicalDocumentImport(
  service: MedicalDocumentImportService = medicalDocumentImportService,
) {
  const [stagedDocument, setStagedDocument] =
    useState<StagedMedicalDocument | null>(null);
  const [activity, setActivity] = useState<ImportActivity>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<
    MedicalDocumentSourceRecord[]
  >([]);
  const [savedDocumentsLoading, setSavedDocumentsLoading] = useState(true);
  const [sourceDetail, setSourceDetail] = useState<SavedMedicalDocument | null>(
    null,
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);

  const loadSavedDocuments = useCallback(async () => {
    setSavedDocumentsLoading(true);
    setSourceMessage(null);
    try {
      setSavedDocuments(await service.listDocuments());
    } catch {
      setSourceMessage(t('medicalDocument.source.loadError'));
    } finally {
      setSavedDocumentsLoading(false);
    }
  }, [service]);

  useEffect(() => {
    loadSavedDocuments().catch(() => undefined);
  }, [loadSavedDocuments]);

  useNavigationLeaveStateRegistration({
    canLeave: activity === null && stagedDocument === null,
    hasUnsavedChanges: stagedDocument !== null,
    isRecording: false,
    hasOngoingOperation: activity !== null,
    revision: stagedDocument === null ? 0 : 1,
    inputRevision: stagedDocument === null ? 0 : 1,
  });

  async function selectMedicalDocument() {
    if (activity !== null || stagedDocument !== null) return;
    setMessage(null);
    setActivity('selecting');
    try {
      const selected = await service.selectDocument();
      if (selected) setStagedDocument(selected);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setActivity(null);
    }
  }

  async function saveMedicalDocument() {
    if (!stagedDocument || activity !== null) return;
    setMessage(null);
    setActivity('saving');
    try {
      const result = await service.saveDocument(stagedDocument);
      setStagedDocument(null);
      setMessage(
        result === 'duplicate'
          ? t('medicalDocument.review.duplicate')
          : t('medicalDocument.review.saved'),
      );
      await loadSavedDocuments();
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setActivity(null);
    }
  }

  async function discardMedicalDocument() {
    if (!stagedDocument || activity !== null) return;
    setActivity('discarding');
    setMessage(null);
    try {
      await service.discardDocument(stagedDocument);
      setStagedDocument(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setActivity(null);
    }
  }

  async function openSavedDocument(sourceId: string) {
    setSourceLoading(true);
    setSourceMessage(null);
    try {
      const document = await service.getDocument(sourceId);
      if (!document) {
        setSourceMessage(t('medicalDocument.source.notFound'));
        return;
      }
      setSourceDetail(document);
    } catch {
      setSourceMessage(t('medicalDocument.source.loadError'));
    } finally {
      setSourceLoading(false);
    }
  }

  function closeSavedDocument() {
    setSourceDetail(null);
    setSourceMessage(null);
  }

  return {
    closeSavedDocument,
    activity,
    discardMedicalDocument,
    message,
    openSavedDocument,
    saveMedicalDocument,
    selectMedicalDocument,
    savedDocuments,
    savedDocumentsLoading,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  };
}

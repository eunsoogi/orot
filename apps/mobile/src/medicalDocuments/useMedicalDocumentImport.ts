import { useCallback, useEffect, useRef, useState } from 'react';
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
    case 'SAVE_FAILED':
      return t('medicalDocument.error.saveFailed');
    case 'STALE_DOCUMENT':
      return t('medicalDocument.error.staleDocument');
    case 'DUPLICATE_RECOVERY_FAILED':
      return t('medicalDocument.error.duplicateRecoveryFailed');
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
  const operationInProgress = useRef(false);
  const [message, setMessage] = useState<string | null>(null);
  const [savedDocuments, setSavedDocuments] = useState<
    MedicalDocumentSourceRecord[]
  >([]);
  const [savedDocumentsState, setSavedDocumentsState] = useState<
    'loading' | 'ready' | 'failed'
  >('loading');
  // Keep list-read failures separate from opening one source, so a detail error cannot hide the feed.
  const [savedDocumentsError, setSavedDocumentsError] = useState<string | null>(
    null,
  );
  const [sourceDetail, setSourceDetail] = useState<SavedMedicalDocument | null>(
    null,
  );
  const [sourceLoading, setSourceLoading] = useState(false);
  const [sourceMessage, setSourceMessage] = useState<string | null>(null);
  const listGeneration = useRef(0);

  const loadSavedDocuments = useCallback(async () => {
    const generation = ++listGeneration.current;
    setSavedDocumentsState('loading');
    setSavedDocumentsError(null);
    try {
      const documents = await service.listDocuments();
      // A retry or a post-save read may finish before a superseded request.
      if (generation !== listGeneration.current) return;
      setSavedDocuments(documents);
      setSavedDocumentsState('ready');
    } catch {
      if (generation !== listGeneration.current) return;
      setSavedDocumentsState('failed');
      setSavedDocumentsError(t('medicalDocument.source.loadError'));
    }
  }, [service]);

  useEffect(() => {
    loadSavedDocuments().catch(() => undefined);
    return () => {
      listGeneration.current += 1;
    };
  }, [loadSavedDocuments]);

  useNavigationLeaveStateRegistration({
    canLeave: activity === null && stagedDocument === null,
    hasUnsavedChanges: stagedDocument !== null,
    isRecording: false,
    hasOngoingOperation: activity !== null,
    revision: stagedDocument === null ? 0 : 1,
    inputRevision: stagedDocument === null ? 0 : 1,
  });

  async function selectMedicalDocument(source: 'files' | 'photos' = 'files') {
    if (
      activity !== null ||
      stagedDocument !== null ||
      operationInProgress.current
    )
      return;
    operationInProgress.current = true;
    setMessage(null);
    setActivity('selecting');
    try {
      const selected = await service.selectDocument(source);
      if (selected) setStagedDocument(selected);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      operationInProgress.current = false;
      setActivity(null);
    }
  }

  async function saveMedicalDocument() {
    if (!stagedDocument || activity !== null || operationInProgress.current)
      return;
    // Reserve synchronously so Save and Cancel cannot race before React renders busy state.
    operationInProgress.current = true;
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
      operationInProgress.current = false;
      setActivity(null);
    }
  }

  async function discardMedicalDocument() {
    if (!stagedDocument || activity !== null || operationInProgress.current)
      return;
    operationInProgress.current = true;
    setActivity('discarding');
    setMessage(null);
    try {
      await service.discardDocument(stagedDocument);
      setStagedDocument(null);
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      operationInProgress.current = false;
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
    reloadSavedDocuments: loadSavedDocuments,
    saveMedicalDocument,
    selectMedicalDocument,
    savedDocuments,
    savedDocumentsState,
    savedDocumentsError,
    sourceDetail,
    sourceLoading,
    sourceMessage,
    stagedDocument,
  };
}

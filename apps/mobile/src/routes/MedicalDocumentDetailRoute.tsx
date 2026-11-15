import { useCallback, useEffect, useRef, useState } from 'react';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { MedicalDocumentSourceView } from '../medicalDocuments/MedicalDocumentSourceView';
import {
  medicalDocumentImportService,
  type MedicalDocumentImportService,
  type SavedMedicalDocument,
} from '../medicalDocuments/medicalDocumentImportService';
import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { t } from '../i18n';

/** A real native destination lets UIKit own interactive Back while the existing deletion guard remains authoritative. */
export function MedicalDocumentDetailRoute({
  sourceId,
  service = medicalDocumentImportService,
  onBack,
}: {
  readonly sourceId?: string;
  readonly service?: MedicalDocumentImportService;
  readonly onBack: () => Promise<boolean>;
}) {
  const [document, setDocument] = useState<SavedMedicalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const reload = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setDocument(null);
    setMessage(null);
    try {
      const result = sourceId ? await service.getDocument(sourceId) : null;
      if (request !== generation.current) return;
      setDocument(result);
      if (!result) setMessage(t('medicalDocument.source.notFound'));
    } catch {
      if (request === generation.current)
        setMessage(t('medicalDocument.source.loadError'));
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, [service, sourceId]);
  useEffect(() => {
    reload().catch(() => undefined);
    // Invalidation clears readable excerpts immediately, before asynchronous file cleanup.
    const invalidate = () => {
      generation.current += 1;
      setDocument(null);
      setLoading(false);
      setMessage(t('medicalDocument.source.notFound'));
    };
    const stopSource = subscribeLocalSourceDeletion(invalidate);
    const stopAll = subscribeLocalDataClear(invalidate);
    return () => {
      generation.current += 1;
      stopSource();
      stopAll();
    };
  }, [reload]);
  useNavigationLeaveStateRegistration({
    canLeave: !deleting,
    hasUnsavedChanges: false,
    isRecording: false,
    hasOngoingOperation: deleting,
    revision: 0,
    inputRevision: 0,
  });
  useEffect(() => {
    // Wait for the committed deletion guard to reopen before asking the native stack to pop.
    if (deleted && !deleting) onBack().catch(() => undefined);
  }, [deleted, deleting, onBack]);
  if (document)
    return (
      <MedicalDocumentSourceView
        document={document}
        onBack={() => {
          if (!deleting) onBack().catch(() => undefined);
        }}
        onDeletionBusyChange={setDeleting}
        onDeleted={() => undefined}
        onDeletionCommitted={() => {
          if (mounted.current) setDeleted(true);
        }}
      />
    );
  return (
    <>
      <AppText accessibilityRole="header">
        {t('medicalDocument.source.libraryTitle')}
      </AppText>
      <AppText accessibilityRole={message ? 'alert' : undefined}>
        {loading ? t('medicalDocument.source.loading') : message}
      </AppText>
      {!loading && !deleted ? (
        <AppButton
          title={t('appointments.retry')}
          testID="medical-document-detail-retry"
          onPress={() => {
            reload().catch(() => undefined);
          }}
        />
      ) : null}
    </>
  );
}

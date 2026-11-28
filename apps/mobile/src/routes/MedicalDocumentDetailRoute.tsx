import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { conversationExecutionNative } from '../ragConversation/conversationExecutionNative';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { useNavigationRouteRefresh } from '../navigation/navigationRouteRefresh';
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
  active = true,
  ownership,
}: {
  readonly sourceId?: string;
  readonly service?: MedicalDocumentImportService;
  readonly onBack: () => Promise<boolean>;
  readonly active?: boolean;
  readonly ownership?: NavigationRouteOwnership;
}) {
  const [document, setDocument] = useState<SavedMedicalDocument | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleted, setDeleted] = useState(false);
  const generation = useRef(0);
  const pending = useRef<{
    request: number;
    manual: boolean;
    cancel: () => void;
  } | null>(null);
  const current = useRef({ active, ownership, service, sourceId });
  current.current = { active, ownership, service, sourceId };
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const retireRead = useCallback(() => {
    generation.current += 1;
    const read = pending.current;
    pending.current = null;
    read?.cancel();
  }, []);
  const reload = useCallback(
    async (manual = false, acceptGesture?: () => void) => {
      const owner = current.current;
      const ownsRoute = () =>
        current.current.active &&
        current.current.sourceId === sourceId &&
        current.current.service === service &&
        current.current.ownership === owner.ownership &&
        owner.ownership?.isCurrent() !== false;
      if (
        pending.current !== null ||
        !ownsRoute() ||
        (manual && AppState.currentState !== 'active')
      )
        return;
      const request = ++generation.current;
      const canceled = Symbol('retired document read');
      let cancel = () => {};
      const retired = new Promise<typeof canceled>(resolve => {
        cancel = () => resolve(canceled);
      });
      pending.current = { request, manual, cancel };
      const canPublish = () =>
        request === generation.current &&
        ownsRoute() &&
        (!manual || AppState.currentState === 'active');
      setLoading(true);
      if (!manual) setDocument(null);
      setMessage(null);
      try {
        // Refresh the one route-owned saved source, never the picker or import workflow.
        const readExact = async () => {
          const native = manual ? conversationExecutionNative() : undefined;
          if (
            manual &&
            (!native?.bridgeAvailable ||
              !(await native.protectedDataAvailable()))
          )
            throw new Error('Saved data protection unavailable');
          if (!canPublish()) return null;
          acceptGesture?.();
          const result = sourceId ? await service.getDocument(sourceId) : null;
          // This protected handle can remain warm across a phone lock.
          if (native && !(await native.protectedDataAvailable()))
            throw new Error('Saved data protection unavailable');
          return result;
        };
        const result = await Promise.race([readExact(), retired]);
        if (result === canceled || !canPublish()) return;
        const exact = result?.id === sourceId ? result : null;
        setDocument(exact ?? null);
        if (!exact) setMessage(t('medicalDocument.source.notFound'));
      } catch {
        if (canPublish()) {
          // A failed read cannot establish that an old snapshot is still readable.
          setDocument(null);
          setMessage(t('medicalDocument.source.loadError'));
        }
      } finally {
        if (pending.current?.request === request) {
          pending.current = null;
          if (request === generation.current && ownsRoute()) setLoading(false);
        }
      }
    },
    [service, sourceId],
  );
  useNavigationRouteRefresh(
    active && Boolean(sourceId) && !deleting && !deleted,
    acceptGesture => reload(true, acceptGesture),
  );
  useEffect(() => {
    reload().catch(() => undefined);
    // Invalidation clears readable excerpts immediately, before asynchronous file cleanup.
    const invalidate = () => {
      retireRead();
      setDocument(null);
      setLoading(false);
      setMessage(t('medicalDocument.source.notFound'));
    };
    const stopSource = subscribeLocalSourceDeletion(invalidate);
    const stopAll = subscribeLocalDataClear(invalidate);
    const appState = AppState.addEventListener('change', value => {
      if (value === 'active' || !pending.current?.manual) return;
      // Ordinary suspension retires the unsettled pull without invalidating the parked detail.
      retireRead();
      setLoading(false);
    });
    const native = conversationExecutionNative();
    const stopProtection = native?.bridgeAvailable
      ? native.subscribe(event => {
          if (event.kind !== 'protectedData' || event.available) return;
          // A real lock invalidates settled text and any in-flight result, independent of visibility.
          retireRead();
          setDocument(null);
          setLoading(false);
          setMessage(t('medicalDocument.source.loadError'));
        })
      : undefined;
    return () => {
      retireRead();
      appState.remove();
      stopProtection?.();
      stopSource();
      stopAll();
    };
  }, [ownership, reload, retireRead]);
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
  if (document && document.id === sourceId)
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

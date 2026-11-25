import {
  subscribeLocalDataClear,
  subscribeLocalSourceDeletion,
} from '../storage/localDataClearEvents';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { watchSavedReportNativeProtection } from '../generatedReports/savedReportNativeProtection';
import { openSavedGeneratedReportReferences } from '../memory/openSavedGeneratedReportReferences';
import { GeneratedVisitQuestionPreview } from '../memory/GeneratedVisitQuestionPreview';
import {
  archivedVisitBookmarkOriginal,
  type ArchivedVisitBookmarkMarker,
} from '../storage/archivedVisitBookmarkIdentity';
import { AppButton } from '../layout/AppButton';
import { AppText } from '../layout/AppText';
import { t } from '../i18n';
import { useConversationSessions } from './ConversationSessionsContext';
import {
  captureReportBookmarkOwner,
  type ReportBookmarkVisibility,
} from './reportBookmarkOwnership';

type Reader = Awaited<ReturnType<typeof openSavedGeneratedReportReferences>>;
type Preview = NonNullable<
  Awaited<ReturnType<Reader['readArchivedVisitBookmarkPreview']>>
>;
type Flight = {
  controller: AbortController;
  close?: () => void;
  storage?: Reader;
  preview?: Preview;
  confirm?: () => Promise<boolean>;
  current: () => boolean;
  saving: boolean;
  lease: { id: string; version: number };
};

type PreviewStatus =
  | { kind: 'idle' | 'loading' | 'saved' | 'failed' }
  | { kind: 'preview'; preview: Preview; saving: boolean };

/** A cold transcript never holds candidate bodies. The selected, still-owned
 * preview alone can offer the separate explicit save using the existing writer. */
export function ArchivedVisitQuestionBookmark({
  marker,
  turn,
  localId,
  visible,
}: {
  marker: ArchivedVisitBookmarkMarker;
  turn: { readonly id: string; readonly createdAt: string };
  localId: number;
  visible?: ReportBookmarkVisibility;
}) {
  const store = useConversationSessions();
  const active = useRef<Flight | undefined>(undefined);
  const mounted = useRef(false);
  const [status, setStatus] = useState<PreviewStatus>({ kind: 'idle' });
  const retire = useCallback((flight: Flight) => {
    if (active.current !== flight) return;
    active.current = undefined;
    flight.controller.abort();
    flight.close?.();
    if (flight.preview)
      flight.storage?.abandonArchivedVisitBookmarkPreview(flight.preview);
  }, []);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (active.current) retire(active.current);
    };
  }, [retire]);

  const open = async () => {
    const lease = store.savedReportLease(localId);
    const original = lease && archivedVisitBookmarkOriginal(marker, lease);
    if (
      !lease ||
      original?.id !== turn.id ||
      original.createdAt !== turn.createdAt ||
      active.current
    )
      return;
    const controller = new AbortController();
    const flight: Flight = {
      controller,
      lease,
      current: () => false,
      saving: false,
    };
    active.current = flight;
    const lost = () => {
      if (active.current !== flight) return;
      retire(flight);
      if (mounted.current) setStatus({ kind: 'idle' });
    };
    const owner = captureReportBookmarkOwner({
      store,
      sessionId: localId,
      current: visible,
      mounted: () => mounted.current && active.current === flight,
      allowDraftChanges: true,
      onLost: lost,
    });
    const clear = subscribeLocalDataClear(lost);
    const deleted = subscribeLocalSourceDeletion(lost);
    flight.close = () => {
      clear();
      deleted();
      owner.close();
    };
    flight.current = () =>
      !controller.signal.aborted &&
      active.current === flight &&
      owner.current();
    if (!flight.current()) {
      flight.close();
      retire(flight);
      return;
    }
    const native = watchSavedReportNativeProtection(controller.signal, lost);
    if (!native) {
      lost();
      return;
    }
    flight.confirm = native.confirm;
    setStatus({ kind: 'loading' });
    try {
      if (!(await native.confirm()) || !flight.current()) return;
      const storage = await openSavedGeneratedReportReferences();
      if (!flight.current()) return;
      flight.storage = storage;
      const preview = await storage.readArchivedVisitBookmarkPreview({
        marker,
        lease,
        current: flight.current,
      });
      if (preview && flight.current()) flight.preview = preview;
      else if (preview) storage.abandonArchivedVisitBookmarkPreview(preview);
      if (!(await native.confirm()) || !flight.current()) return;
      if (!preview)
        throw new Error('The visit preview is no longer available.');
      setStatus({ kind: 'preview', preview, saving: false });
    } catch {
      const current = flight.current();
      retire(flight);
      if (current && mounted.current) setStatus({ kind: 'failed' });
    }
  };

  const save = async () => {
    const flight = active.current;
    if (
      !flight?.preview ||
      !flight.storage ||
      !flight.confirm ||
      flight.saving ||
      !flight.current()
    )
      return;
    flight.saving = true;
    setStatus({ kind: 'preview', preview: flight.preview, saving: true });
    let saved = false;
    try {
      saved = await flight.storage.bookmarkArchivedVisitQuestions({
        preview: flight.preview,
        lease: flight.lease,
        current: flight.current,
        confirmProtected: flight.confirm,
      });
    } catch {
      // The owning transaction rolls back if the shown archive moved.
    } finally {
      const current = flight.current();
      retire(flight);
      if (current && mounted.current)
        setStatus({ kind: saved ? 'saved' : 'failed' });
    }
  };
  if (status.kind === 'preview')
    return (
      <View testID="conversation-archived-visit-preview">
        <AppText accessibilityRole="header">
          {t('savedMemory.generatedReportVisitQuestions')}
        </AppText>
        <GeneratedVisitQuestionPreview questions={status.preview.questions} />
        <AppButton
          title={t('savedMemory.bookmarkVisitQuestions')}
          variant="neutral"
          disabled={status.saving}
          testID="conversation-save-archived-visit-questions"
          onPress={() => {
            save();
          }}
        />
      </View>
    );
  return (
    <>
      {status.kind !== 'saved' && (
        <AppButton
          title={t('savedMemory.previewArchivedVisitQuestions')}
          variant="neutral"
          disabled={status.kind === 'loading'}
          testID="conversation-preview-archived-visit-questions"
          onPress={() => {
            open();
          }}
        />
      )}
      {status.kind !== 'idle' && (
        <AppText accessibilityLiveRegion="polite">
          {t(
            status.kind === 'saved'
              ? 'savedMemory.generatedReportSaved'
              : status.kind === 'loading'
                ? 'savedMemory.loading'
                : 'savedMemory.generatedReportUnavailable',
          )}
        </AppText>
      )}
    </>
  );
}

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { AppText } from '../layout/AppText';
import type { NavigationRouteOwnership } from '../navigation/navigationRouteContracts';
import { t } from '../i18n';
import { useNavigationRouteActions } from '../navigation/useNavigationRouteActions';
import RecordingDeletionConfirmation from './RecordingDeletionConfirmation';
import { recordingLibraryService } from './recordingLibraryService';
import type { RecordingSourceRecord } from './recordingTypes';

type Props = Readonly<{
  source: RecordingSourceRecord;
  active: boolean;
  actionsDisabled?: boolean;
  routeOwner?: NavigationRouteOwnership;
  onBusyChange?: (value: boolean) => void;
  onDeleted?: () => void | Promise<boolean>;
}>;

type Approval = {
  key: number;
  source: RecordingSourceRecord;
  owner: NavigationRouteOwnership;
  retired: boolean;
};

/** Reuse the existing confirmation and service; no stored audio is deleted by
 * presentation code. Each native alert authorizes exactly its captured target. */
export function SavedRecordingDeleteAction(props: Props) {
  const mounted = useRef(false);
  const latest = useRef(props);
  const sequence = useRef(0);
  const pending = useRef<Approval | undefined>(undefined);
  const running = useRef<Approval | undefined>(undefined);
  const awaitingBack = useRef<Approval | undefined>(undefined);
  const [target, setTarget] = useState<Approval>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [committed, setCommitted] = useState<Approval>();

  useLayoutEffect(() => {
    latest.current = props;
  }, [props]);
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (pending.current) pending.current.retired = true;
      if (running.current) running.current.retired = true;
      if (awaitingBack.current) awaitingBack.current.retired = true;
    };
  }, []);

  const owner = props.routeOwner;
  const sourceId = props.source.id;
  const completedCurrent =
    committed?.source.id === sourceId && committed.owner === owner;

  useLayoutEffect(() => {
    const retireChanged = () => {
      const hasOwner = props.active && owner?.isCurrent() === true;
      const changed = (entry: Approval) =>
        !hasOwner || entry.owner !== owner || entry.source.id !== sourceId;
      const approval = pending.current;
      if (approval && changed(approval)) {
        approval.retired = true;
        pending.current = undefined;
        setTarget(undefined);
      }
      const operation = running.current;
      if (operation && changed(operation)) operation.retired = true;
      const completion = awaitingBack.current;
      if (completion && changed(completion)) completion.retired = true;
    };
    retireChanged();
    return owner?.subscribe(retireChanged);
  }, [owner, props.active, sourceId]);

  const owned = useCallback(
    (entry: Approval) =>
      mounted.current &&
      !entry.retired &&
      latest.current.active &&
      latest.current.routeOwner === entry.owner &&
      latest.current.source.id === entry.source.id &&
      entry.owner.isCurrent(),
    [],
  );

  useEffect(() => {
    // Let the parent's busy/leave-state registration commit before requesting
    // Back. A retired operation must never close a replacement destination.
    if (!committed || awaitingBack.current !== committed) return;
    awaitingBack.current = undefined;
    if (!owned(committed)) return;
    committed.retired = true;
    try {
      Promise.resolve(latest.current.onDeleted?.()).catch(() => undefined);
    } catch {
      // An already committed deletion cannot be undone by failed navigation.
    }
  }, [committed, owned]);

  function request() {
    if (
      !mounted.current ||
      latest.current.actionsDisabled ||
      !latest.current.active ||
      pending.current ||
      running.current ||
      awaitingBack.current ||
      completedCurrent ||
      !owner?.isCurrent()
    )
      return;
    const entry = {
      key: ++sequence.current,
      source: latest.current.source,
      owner,
      retired: false,
    };
    pending.current = entry;
    setError(false);
    setTarget(entry);
  }

  function cancel(entry: Approval) {
    if (pending.current !== entry) return;
    pending.current = undefined;
    entry.retired = true;
    setTarget(undefined);
  }

  async function confirm(entry: Approval) {
    if (pending.current !== entry || running.current) return;
    if (!owned(entry) || latest.current.actionsDisabled) {
      cancel(entry);
      return;
    }
    pending.current = undefined;
    running.current = entry;
    setTarget(undefined);
    setBusy(true);
    latest.current.onBusyChange?.(true);
    try {
      await recordingLibraryService.deleteRecording(entry.source.id);
      if (mounted.current) {
        awaitingBack.current = entry;
        setCommitted(entry);
      }
    } catch {
      if (owned(entry)) setError(true);
    } finally {
      running.current = undefined;
      if (mounted.current) {
        setBusy(false);
        latest.current.onBusyChange?.(false);
      }
    }
  }

  const label = t('recording.library.delete');
  useNavigationRouteActions(
    [
      {
        id: 'saved-recording-detail-delete',
        label,
        accessibilityLabel: label,
        testID: 'saved-recording-detail-delete',
        systemImageName: 'trash',
        destructive: true,
        disabled:
          !owner?.isCurrent() ||
          props.actionsDisabled ||
          !!target ||
          busy ||
          completedCurrent,
        onPress: request,
      },
    ],
    props.active,
  );

  return (
    <>
      <RecordingDeletionConfirmation
        key={target?.key ?? 'settled'}
        target={target?.source ?? null}
        busy={busy}
        onCancel={() => {
          if (target) cancel(target);
        }}
        onConfirm={() => target && confirm(target)}
      />
      {error ? (
        <AppText
          accessibilityRole="alert"
          testID="saved-recording-delete-error"
        >
          {t('recording.library.deleteError')}
        </AppText>
      ) : null}
    </>
  );
}

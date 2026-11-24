import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncNotice } from '../healthkit/autoSyncSettings';
import {
  configureLocalHealthKitAutoSync,
  loadLocalHealthKitAutoSyncSelection,
} from '../healthkit/autoSyncLocal';
import { useNavigationLeaveStateRegistration } from '../navigation';
import { HealthDataIntegrationScreen } from './HealthDataIntegrationScreen';
import {
  loadHealthDataIntegrationStatus,
  type HealthDataIntegrationStatus,
} from './HealthDataIntegrationStatus';

/** Lets users choose local HealthKit categories that refresh automatically. */
export function HealthDataIntegrationRoute({
  loadSelection = loadLocalHealthKitAutoSyncSelection,
  saveSelection = configureLocalHealthKitAutoSync,
  loadIntegrationStatus = loadHealthDataIntegrationStatus,
}: {
  readonly loadSelection?: () => Promise<readonly HealthKitAutoSyncFeature[]>;
  readonly saveSelection?: (
    features: readonly HealthKitAutoSyncFeature[],
    onSelectionCommitted?: () => void,
  ) => Promise<HealthKitAutoSyncNotice>;
  readonly loadIntegrationStatus?: () => Promise<HealthDataIntegrationStatus>;
}) {
  const [selected, setSelected] = useState<
    ReadonlySet<HealthKitAutoSyncFeature>
  >(new Set());
  const [saved, setSaved] = useState<ReadonlySet<HealthKitAutoSyncFeature>>(
    new Set(),
  );
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [integrationStatus, setIntegrationStatus] =
    useState<HealthDataIntegrationStatus | null>(null);
  const [statusLoadFailed, setStatusLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [committing, setCommitting] = useState(false);
  const inFlight = useRef<symbol | null>(null);
  useLayoutEffect(
    () => () => {
      inFlight.current = null;
    },
    [],
  );
  const [notice, setNotice] = useState<HealthKitAutoSyncNotice | null>(null);
  const [revision, setRevision] = useState(0);
  const [loadRevision, setLoadRevision] = useState(0);
  const [statusRevision, setStatusRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setLoadFailed(false);
    setLoaded(false);
    loadSelection()
      .then(features => {
        if (!active) return;
        const next = new Set(features);
        setSelected(next);
        setSaved(next);
        setLoaded(true);
      })
      .catch(() => active && setLoadFailed(true));
    return () => {
      active = false;
    };
  }, [loadRevision, loadSelection]);

  useEffect(() => {
    let active = true;
    setStatusLoadFailed(false);
    setIntegrationStatus(null);
    loadIntegrationStatus()
      .then(status => {
        if (!active) return;
        setIntegrationStatus(status);
        setStatusLoadFailed(status.statusLoadFailed);
      })
      .catch(() => active && setStatusLoadFailed(true));
    return () => {
      active = false;
    };
  }, [loadIntegrationStatus, statusRevision]);

  useEffect(() => {
    // Returning from Apple Health refreshes saved sync status only; it never requests permission or samples.
    let wasAway =
      AppState.currentState === 'background' ||
      AppState.currentState === 'inactive';
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') {
        if (wasAway) setStatusRevision(value => value + 1);
        wasAway = false;
      } else if (state === 'background' || state === 'inactive') {
        wasAway = true;
      }
    });
    return () => subscription.remove();
  }, []);

  const dirty = !sameSelection(selected, saved);
  useNavigationLeaveStateRegistration({
    canLeave: !committing,
    hasUnsavedChanges: dirty,
    isRecording: false,
    // Only the pending durable write blocks leaving. The existing HealthKit
    // authorization and refresh neither own navigation nor roll back that write.
    hasOngoingOperation: false,
    revision,
    inputRevision: revision,
  });

  function toggle(feature: HealthKitAutoSyncFeature) {
    setNotice(null);
    setRevision(value => value + 1);
    setSelected(current => {
      const next = new Set(current);
      if (next.has(feature)) next.delete(feature);
      else next.add(feature);
      return next;
    });
  }

  function retryLoad() {
    setLoadRevision(value => value + 1);
  }

  function retryStatus() {
    setStatusRevision(value => value + 1);
  }

  async function save() {
    if (!loaded || inFlight.current) return;
    const token = Symbol('health-data-save');
    inFlight.current = token;
    const current = () => inFlight.current === token;
    let committed = false;
    setSaving(true);
    setCommitting(true);
    setNotice(null);
    const features = [...selected];
    const confirmCommit = () => {
      if (!current() || committed) return;
      committed = true;
      setSaved(new Set(features));
      setCommitting(false);
    };
    try {
      const result = await saveSelection(features, confirmCommit);
      if (!current()) return;
      setNotice(result);
      if (result.status !== 'selection_save_failed') {
        confirmCommit();
        setStatusRevision(value => value + 1);
      }
    } catch {
      if (current())
        setNotice({
          status: committed ? 'retryable' : 'selection_save_failed',
        });
    } finally {
      if (current()) {
        inFlight.current = null;
        setCommitting(false);
        setSaving(false);
      }
    }
  }

  return (
    <HealthDataIntegrationScreen
      integrationStatus={integrationStatus}
      loadFailed={loadFailed}
      loaded={loaded}
      notice={notice}
      onRetryLoad={retryLoad}
      onRetryStatus={retryStatus}
      onSave={save}
      onToggle={toggle}
      saving={saving}
      selected={selected}
      statusLoadFailed={statusLoadFailed}
    />
  );
}

function sameSelection(
  left: ReadonlySet<HealthKitAutoSyncFeature>,
  right: ReadonlySet<HealthKitAutoSyncFeature>,
): boolean {
  return (
    left.size === right.size && [...left].every(feature => right.has(feature))
  );
}

import { useEffect, useState } from 'react';
import type { HealthKitAutoSyncFeature } from '../healthkit/autoSyncCheckpoint';
import type { HealthKitAutoSyncConfigurationResult } from '../healthkit/autoSyncSettings';
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
  ) => Promise<{
    readonly status: HealthKitAutoSyncConfigurationResult['status'];
  }>;
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
  const [notice, setNotice] = useState<
    HealthKitAutoSyncConfigurationResult['status'] | null
  >(null);
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

  const dirty = !sameSelection(selected, saved);
  useNavigationLeaveStateRegistration({
    canLeave: !saving,
    hasUnsavedChanges: dirty,
    isRecording: false,
    hasOngoingOperation: saving,
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
    if (!loaded || saving) return;
    setSaving(true);
    setNotice(null);
    const features = [...selected];
    try {
      const result = await saveSelection(features);
      setNotice(result.status);
      if (result.status !== 'selection_save_failed') {
        setSaved(new Set(features));
      }
    } catch {
      setNotice('selection_save_failed');
    } finally {
      setSaving(false);
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

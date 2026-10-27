import { useEffect, useMemo, useRef, useState } from 'react';
import { NativeModules, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppText } from '../layout/AppText';
import { AppButton } from '../layout/AppButton';
import { RecordingSelectionProvider } from '../recording/RecordingSelectionContext';
import { RecordingReviewRoute } from '../routes/RecordingReviewRoute';
import { SavedRecordingsRoute } from '../routes/SavedRecordingsRoute';
import type { AppNavigationRoute } from '../routes/appNavigationRoute';
import {
  createNavigationController,
  NavigationRouteAdapter,
} from '../navigation';
import { openLocalStorage } from '../storage/secureDatabase';
import {
  seedSyntheticEncounter,
  syntheticEncounterModel,
} from '../agent/encounter/syntheticFixture';
import { createEncounterReviewService } from './service';
import { createNativeReviewDiagnostics } from './nativeDiagnostics';
function settings() {
  const manager = NativeModules.SettingsManager;
  return manager?.settings ?? manager?.getConstants?.().settings ?? {};
}

/** Native UI tests mount the production route and consent sheet; only the external model is scripted.
 * A caller-owned UUID is reused across real app launches, never generated silently on restore.
 */
export function NativeReviewProbe() {
  return (
    <SafeAreaProvider>
      <RecordingSelectionProvider>
        <ProbeRoute />
      </RecordingSelectionProvider>
    </SafeAreaProvider>
  );
}
function ProbeRoute() {
  const [navigation] = useState(() =>
    createNavigationController<AppNavigationRoute>('saved-recordings'),
  );
  const [ready, setReady] = useState(false);
  const [report, setReport] = useState('loading');
  const [failure, setFailure] = useState(false);
  const readbackSequence = useRef(0);
  const configured = useMemo(settings, []);
  const sourceId = String(configured.OROT_REVIEW_FIXTURE ?? '') + ':ui-review';
  const mode = configured.OROT_REVIEW_MODE;
  const synthetic = useMemo(
    () => syntheticEncounterModel(sourceId, mode !== 'restore'),
    [sourceId, mode],
  );
  const service = useMemo(
    () =>
      createEncounterReviewService(
        async () => ({
          status: 'ready',
          selection: {
            providerId: synthetic.model.provider.id,
            modelId: 'synthetic',
          },
          option: {
            provider: synthetic.model.provider,
            modelId: 'synthetic',
            displayName: 'Synthetic',
            privacyBoundary:
              mode === 'remote' ? 'selected-context-remote' : 'on-device',
            availability: { status: 'available' },
          },
          provider: synthetic.model.provider,
          modelId: 'synthetic',
          recipient:
            mode === 'remote' ? 'Synthetic test recipient' : 'on-device',
          remoteProcessing: mode === 'remote',
        }),
        createNativeReviewDiagnostics(sourceId, synthetic.calls),
      ),
    [synthetic, mode, sourceId],
  );
  useEffect(() => {
    let active = true;
    (async () => {
      if (!/^test-persistence-[a-f0-9-]{36}:ui-review$/i.test(sourceId))
        throw new Error('Owned UI fixture required.');
      const repository = await openLocalStorage();
      let source = await repository.get('source_record', sourceId);
      if (!source && mode === 'restore')
        throw new Error('Restore cannot seed a missing source.');
      if (!source) {
        await seedSyntheticEncounter(repository, sourceId);
        source = await repository.get('source_record', sourceId);
      }
      if (source?.sourceKind !== 'audio_recording')
        throw new Error('Recording fixture missing.');
      if (active) setReady(true);
    })().catch(() => {
      if (active) setFailure(true);
    });
    return () => {
      active = false;
    };
  }, [sourceId, mode]);
  async function readback() {
    const sequence = ++readbackSequence.current;
    const repository = await openLocalStorage();
    const records = (await repository.list('health_observation')).filter(
      record => record.provenance.sourceRecordIds.includes(sourceId),
    );
    const evidence =
      await repository.evidenceSpans.listForSourceRecord(sourceId);
    setReport(
      JSON.stringify({
        readback: sequence,
        records,
        evidence,
        modelCalls: synthetic.calls(),
        diagnostic: await service.diagnostics?.snapshot(),
      }),
    );
  }
  async function cleanup() {
    const repository = await openLocalStorage();
    await repository.sourceRecords.delete(sourceId);
    const restored = await service.restore(
      sourceId,
      new AbortController().signal,
    );
    const records = (await repository.list('health_observation')).filter(
      record => record.provenance.sourceRecordIds.includes(sourceId),
    );
    if (restored.status !== 'unavailable' || records.length) {
      setReport('cleanup-failed');
      return;
    }
    setReport('cleaned');
    setReady(false);
  }
  async function removeSource() {
    await (await openLocalStorage()).sourceRecords.delete(sourceId);
    setReport('removed');
  }
  return (
    <View style={styles.fill}>
      <AppText testID="encounter-probe-ready">
        {failure ? 'failed' : ready ? 'ready' : 'loading'}
      </AppText>
      <AppText numberOfLines={1} testID="encounter-probe-report">
        {report}
      </AppText>
      <AppButton
        title="검증 읽기"
        testID="encounter-probe-readback"
        onPress={readback}
      />
      <AppButton
        title="테스트 자료 정리"
        testID="encounter-probe-cleanup"
        onPress={cleanup}
      />
      <AppButton
        title="다른 화면의 녹음 삭제 재현"
        testID="encounter-probe-remove-source"
        onPress={removeSource}
      />
      {ready ? (
        <NavigationRouteAdapter
          controller={navigation}
          contentLayoutOwner="scene"
          contentSafeAreaHandledByChild
        >
          {actions =>
            actions.route.name === 'saved-recordings' ? (
              <SavedRecordingsRoute actions={actions} />
            ) : actions.route.name === 'recording-review' ? (
              <RecordingReviewRoute reviewService={service} />
            ) : null
          }
        </NavigationRouteAdapter>
      ) : null}
    </View>
  );
}
const styles = StyleSheet.create({ fill: { flex: 1 } });

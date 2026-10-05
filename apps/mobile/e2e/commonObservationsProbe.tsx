import { useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import {
  CommonObservationsImportScreen,
  type CommonObservationsImportCopy,
  type CommonObservationsImportResult,
} from '../src/healthkit/commonObservations/CommonObservationsImportScreen';
import { runCommonObservationsStorageProbe } from '../src/healthkit/commonObservations/e2eProbe';
import type { CommonObservationFeature } from '../src/healthkit/commonObservations/types';

const native = NativeModules.HealthKitModule as Parameters<
  typeof runCommonObservationsStorageProbe
>[0];

const copy: CommonObservationsImportCopy = {
  title: '건강 관측값 가져오기 probe',
  description:
    '합성 HealthKit 결과를 선택 유형별로 가져와 로컬 저장소에서 확인해요.',
  localOnly: '합성 자료는 기기의 암호화된 로컬 저장소에서 확인해요.',
  importButton: '선택한 유형 가져오기',
  featureNames: { heartRate: '심박수', steps: '걸음 수', bodyMass: '체중' },
  statuses: {
    idle: '조회할 유형을 선택해 주세요.',
    importing: 'HealthKit을 조회하고 있어요.',
    complete: '조회와 변환을 마쳤어요.',
    empty: '새로운 변경이 없어요. 읽기 권한 상태는 확인할 수 없어요.',
    overlap: '겹치는 걸음 기록이 있어 합계를 표시하지 않았어요.',
    unavailable: 'HealthKit을 사용할 수 없어요.',
    unsupportedFeature: '선택한 기록 유형은 지원하지 않아요.',
    unsupportedPlatform: '이 기기에서는 HealthKit을 지원하지 않아요.',
    unsupportedData: '지원할 수 없는 자료가 있어 가져오기를 멈췄어요.',
    partial: '일부 유형을 가져오지 못했어요.',
    failed: 'HealthKit query probe에 실패했어요.',
  },
  changeSummary: (imported, deleted, unsupported) =>
    `${imported}개 확인, ${deleted}개 삭제, ${unsupported}개 미지원`,
};

/** Runs the production importer against the Simulator's non-persistent fixture. */
export function CommonObservationsProbe() {
  const [summary, setSummary] = useState(
    'probe=ready; storage=encrypted-local',
  );

  async function importSelected(
    selectedFeatures: readonly CommonObservationFeature[],
  ): Promise<CommonObservationsImportResult> {
    setSummary('probe=running; storage=encrypted-local');
    try {
      const outcome = await runCommonObservationsStorageProbe(
        native,
        selectedFeatures,
      );
      setSummary(outcome.summary);
      return outcome.result;
    } catch (error) {
      setSummary('probe=failed; storage=encrypted-local');
      console.error('COMMON_OBSERVATIONS_SIMULATOR_FAILURE');
      throw error;
    }
  }

  return (
    <View style={styles.container}>
      <CommonObservationsImportScreen copy={copy} onImport={importSelected} />
      <Text
        accessibilityLiveRegion="polite"
        testID="common-observations-probe-summary"
      >
        {summary}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

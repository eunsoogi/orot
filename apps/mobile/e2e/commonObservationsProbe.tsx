import { useState } from 'react';
import { NativeModules, StyleSheet, Text, View } from 'react-native';
import { createHealthKitClient } from '../src/healthkit/client';
import type {
  HealthKitFeature,
  HealthKitNativeModule,
  HealthKitSampleKind,
  HealthKitSampleSnapshot,
} from '../src/healthkit/types';
import {
  CommonObservationsImportScreen,
  type CommonObservationsImportCopy,
  type CommonObservationsImportResult,
} from '../src/healthkit/commonObservations/CommonObservationsImportScreen';
import { mapCommonObservationSample } from '../src/healthkit/commonObservations/mapper';
import { evaluateStepAggregation } from '../src/healthkit/commonObservations/steps';
import type {
  CommonObservationFeature,
  MappedCommonObservation,
} from '../src/healthkit/commonObservations/types';

interface CommonObservationsProbeModule extends HealthKitNativeModule {
  prepareSyntheticFixture(
    feature: HealthKitFeature,
  ): Promise<{ readonly mode: 'synthetic' }>;
  removeSyntheticFixture(): Promise<void>;
  inspectReadAuthorizationPlan(feature: HealthKitFeature): Promise<{
    readonly availability: 'available' | 'unsupportedFeature';
    readonly readTypeIdentifiers: readonly string[];
    readonly writeTypeIdentifiers: readonly string[];
  }>;
  inspectSampleType(
    feature: HealthKitFeature,
    sampleKind: HealthKitSampleKind,
  ): Promise<string>;
}

const expectedSampleTypes: Readonly<Record<CommonObservationFeature, string>> =
  {
    heartRate: 'HKQuantityTypeIdentifierHeartRate',
    steps: 'HKQuantityTypeIdentifierStepCount',
    bodyMass: 'HKQuantityTypeIdentifierBodyMass',
  };
const range = {
  startDate: '2026-10-01T00:00:00.000Z',
  endDate: '2026-10-06T00:00:00.000Z',
};
const native = NativeModules.HealthKitModule as CommonObservationsProbeModule;
const healthKit = createHealthKitClient(native, 'ios');

const copy: CommonObservationsImportCopy = {
  title: '건강 관측값 가져오기 probe',
  description: '합성 HealthKit 결과를 선택 유형별로 조회하고 변환해요.',
  localOnly: 'probe는 결과를 저장하지 않고 이 화면에서만 확인해요.',
  importButton: '선택한 유형 조회하기',
  featureNames: { heartRate: '심박수', steps: '걸음 수', bodyMass: '체중' },
  statuses: {
    idle: '조회할 유형을 선택해 주세요.',
    importing: 'HealthKit을 조회하고 있어요.',
    complete: '조회와 변환을 마쳤어요.',
    empty: '표시 가능한 자료가 없어요. 읽기 권한 상태는 확인할 수 없어요.',
    overlap: '겹치는 걸음 기록이 있어 합계를 표시하지 않았어요.',
    unavailable: 'HealthKit을 사용할 수 없어요.',
    unsupportedFeature: '선택한 기록 유형은 지원하지 않아요.',
    unsupportedPlatform: '이 기기에서는 HealthKit을 지원하지 않아요.',
    failed: 'HealthKit query probe에 실패했어요.',
  },
  importedCount: count => `${count}개 관측값을 확인했어요.`,
};

/** Exercises the read-only mapper flow with DEBUG fixtures and no persistence. */
export function CommonObservationsProbe() {
  const [summary, setSummary] = useState('probe=ready; storage=not-performed');

  async function querySelected(
    features: readonly CommonObservationFeature[],
  ): Promise<CommonObservationsImportResult> {
    const availability = await healthKit.getAvailability();
    if (availability.status !== 'available') {
      setSummary(`availability=${availability.status}; storage=not-performed`);
      return {
        status:
          availability.status === 'unsupportedPlatform'
            ? 'unsupportedPlatform'
            : 'unavailable',
        importedCount: 0,
      };
    }
    const outcomes: string[] = [];
    const mapped: MappedCommonObservation[] = [];
    for (const feature of features) {
      const result = await queryFeature(feature);
      if (result.status !== 'completed') {
        setSummary(`feature=${feature}; query=${result.status}`);
        return {
          status: result.status,
          importedCount: mapped.length,
        };
      }
      outcomes.push(result.summary);
      mapped.push(...result.observations);
    }

    const steps = evaluateStepAggregation(mapped);
    if (steps.status === 'overlap') {
      setSummary(
        `availability=${availability.status}; ${outcomes.join(';')}; writeTypes=0; stepAggregation=overlap; storage=not-performed`,
      );
      return { status: 'overlap', importedCount: mapped.length };
    }
    setSummary(
      `availability=${availability.status}; ${outcomes.join(';')}; writeTypes=0; stepAggregation=${steps.status}${steps.status === 'safe' ? `:${steps.total}` : ''}; storage=not-performed`,
    );
    return {
      status: mapped.length === 0 ? 'empty' : 'complete',
      importedCount: mapped.length,
    };
  }

  return (
    <View style={styles.container}>
      <CommonObservationsImportScreen copy={copy} onImport={querySelected} />
      <Text
        accessibilityLiveRegion="polite"
        testID="common-observations-probe-summary"
      >
        {summary}
      </Text>
    </View>
  );
}

async function queryFeature(feature: CommonObservationFeature): Promise<
  | {
      readonly status: 'completed';
      readonly observations: readonly MappedCommonObservation[];
      readonly summary: string;
    }
  | {
      readonly status:
        'unavailable' | 'unsupportedFeature' | 'unsupportedPlatform';
    }
> {
  // The fixture keeps each query deterministic; authorization remains opaque to callers.
  let fixtureInstalled = false;
  try {
    const plan = await native.inspectReadAuthorizationPlan(feature);
    if (plan.availability === 'unsupportedFeature')
      return { status: 'unsupportedFeature' };
    if (plan.writeTypeIdentifiers.length !== 0) {
      throw new Error(`${feature} requests HealthKit write access.`);
    }
    const expectedType = expectedSampleTypes[feature];
    if (
      JSON.stringify([...plan.readTypeIdentifiers].sort()) !==
      JSON.stringify([expectedType])
    ) {
      throw new Error(`${feature} does not have a feature-scoped read plan.`);
    }
    const actualType = await native.inspectSampleType(feature, feature);
    if (actualType !== expectedType) {
      throw new Error(`${feature} query selected an unexpected sample type.`);
    }

    const fixture = await native.prepareSyntheticFixture(feature);
    fixtureInstalled = true;
    if (fixture.mode !== 'synthetic')
      throw new Error('Fixture mode is not synthetic.');
    const authorization = await healthKit.requestReadAuthorization(feature);
    if (authorization.availability !== 'available') {
      return { status: authorization.availability };
    }
    const query = await healthKit.querySamples({
      feature,
      sampleKind: feature,
      ...range,
      limit: 25,
    });
    if (query.status !== 'completed') return { status: query.availability };

    const observations = query.samples.map(sample =>
      mapSample(feature, sample),
    );
    const mapped = observations.filter(
      (item): item is MappedCommonObservation => item !== null,
    );
    if (mapped.length !== query.samples.length) {
      throw new Error(
        `${feature} query returned a sample the mapper rejected.`,
      );
    }
    const evidence = mapped[0];
    const summary =
      mapped.length === 0
        ? `${feature}=empty:authorization=${authorization.requestStatus}:${query.readAuthorization}`
        : `${feature}=mapped:${mapped.length}:${evidence?.value.unit}:${evidence?.sourceIdentifier}:${evidence?.sourceSampleId}:${evidence?.startDate}/${evidence?.endDate}:authorization=${authorization.requestStatus}:${authorization.readAuthorization}`;
    return { status: 'completed', observations: mapped, summary };
  } finally {
    // The DEBUG simulator fixture is in-memory and never writes HealthKit samples.
    if (fixtureInstalled) await native.removeSyntheticFixture();
  }
}

function mapSample(
  feature: CommonObservationFeature,
  sample: HealthKitSampleSnapshot,
): MappedCommonObservation | null {
  const result = mapCommonObservationSample(feature, sample);
  return result.status === 'mapped' ? result.observation : null;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    padding: 24,
    backgroundColor: '#f7f8fa',
  },
});

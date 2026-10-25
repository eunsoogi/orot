import type { HealthKitImportScreenCopy } from '../src/healthkit/unifiedImport/HealthKitImportScreen';

/** Keeps probe labels focused on status and never prints source values. */
export const unifiedImportProbeCopy: HealthKitImportScreenCopy = {
  title: 'HealthKit 가져오기',
  description: '필요한 건강 항목과 캘린더 후보를 선택한 뒤 한 번에 시작하세요.',
  localOnly:
    '건강 기록은 암호화 저장소에 보관하고, 캘린더 일정은 직접 확인한 한 건만 저장합니다.',
  readAuthorization: 'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.',
  importButton: '선택 항목 가져오기',
  cancelButton: '다음 단계 취소',
  featureNames: {
    medications: '약 및 복용 기록',
    bloodPressure: '혈압',
    sleep: '수면',
    heartRate: '심박수',
    steps: '걸음 수',
    bodyMass: '체중',
  },
  featureStatuses: Object.fromEntries(
    [
      'notSelected',
      'waitingAuthorization',
      'ready',
      'querying',
      'persisting',
      'complete',
      'empty',
      'partial',
      'unsupportedFeature',
      'unsupportedPlatform',
      'unavailable',
      'unsupportedData',
      'notRun',
      'failed',
      'cancelled',
    ].map(status => [status, status]),
  ) as HealthKitImportScreenCopy['featureStatuses'],
  phaseStatuses: Object.fromEntries(
    [
      'queued',
      'authorizingHealthKit',
      'authorizingEventKit',
      'preparingStorage',
      'querying',
      'queryingEventKit',
      'cancelling',
      'complete',
      'empty',
      'partial',
      'failed',
      'cancelled',
    ].map(status => [status, status]),
  ) as HealthKitImportScreenCopy['phaseStatuses'],
  changeSummary: (imported, deleted) =>
    `${imported}개 저장 · ${deleted}개 삭제`,
};

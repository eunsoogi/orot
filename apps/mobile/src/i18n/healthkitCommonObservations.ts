// Empty HealthKit results cannot establish denial because read authorization is unobservable.
export const commonObservationsKo = {
  'healthkit.commonObservations.open': '건강 기록 가져오기',
  'healthkit.commonObservations.title': '건강 기록 가져오기',
  'healthkit.commonObservations.description':
    '가져올 심박수, 걸음 수, 체중 기록을 직접 선택해 주세요.',
  'healthkit.commonObservations.localOnly':
    '선택한 기록만 이 기기의 암호화된 저장소에 보관하고 외부로 전송하지 않아요.',
  'healthkit.commonObservations.back': '뒤로',
  'healthkit.commonObservations.import': '선택한 기록 가져오기',
  'healthkit.commonObservations.heartRate': '심박수',
  'healthkit.commonObservations.steps': '걸음 수',
  'healthkit.commonObservations.bodyMass': '체중',
  'healthkit.commonObservations.status.idle':
    '가져올 기록 유형을 선택해 주세요.',
  'healthkit.commonObservations.status.importing':
    '선택한 HealthKit 기록을 불러오고 있어요…',
  'healthkit.commonObservations.status.complete':
    '선택한 기록의 변경을 가져왔어요.',
  'healthkit.commonObservations.status.empty':
    '새로운 변경이 없어요. HealthKit 읽기 권한 상태는 앱에서 확인할 수 없어요.',
  'healthkit.commonObservations.status.unavailable':
    'HealthKit을 사용할 수 없어요.',
  'healthkit.commonObservations.status.unsupportedFeature':
    '선택한 기록 유형은 이 기기에서 지원하지 않아요.',
  'healthkit.commonObservations.status.unsupportedPlatform':
    '이 플랫폼에서는 HealthKit을 지원하지 않아요.',
  'healthkit.commonObservations.status.unsupportedData':
    '처리할 수 없는 기록이 있어 가져오기를 멈췄어요.',
  'healthkit.commonObservations.status.partial':
    '일부 기록은 가져왔지만 모든 유형을 처리하지 못했어요.',
  'healthkit.commonObservations.status.failed':
    '건강 기록을 가져오지 못했어요. 다시 시도해 주세요.',
  'healthkit.commonObservations.status.summary':
    '{imported}개 저장, {deleted}개 삭제, {unsupported}개 미지원',
} as const;

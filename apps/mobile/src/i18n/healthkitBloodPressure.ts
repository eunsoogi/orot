// Keep HealthKit source limitations explicit in the user-visible blood-pressure record view.
export const bloodPressureKo = {
  'healthkit.bloodPressure.open': '혈압 기록 가져오기',
  'healthkit.bloodPressure.title': '혈압 기록',
  'healthkit.bloodPressure.description':
    'HealthKit에서 가져온 수축기와 이완기 측정값을 확인할 수 있어요.',
  'healthkit.bloodPressure.localOnly':
    '가져온 기록은 이 기기의 암호화된 저장소에 보관해요.',
  'healthkit.bloodPressure.import': 'HealthKit 혈압 기록 가져오기',
  'healthkit.bloodPressure.openLibrary': '가져온 기록 보기',
  'healthkit.bloodPressure.importAgain': '다시 가져오기',
  'healthkit.bloodPressure.summary.saved': '반영된 기록',
  'healthkit.bloodPressure.summary.deleted': '삭제된 기록',
  'healthkit.bloodPressure.summary.count': '{count}개',
  'healthkit.bloodPressure.readAuthorization':
    'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.',
  'healthkit.bloodPressure.component.systolic': '수축기',
  'healthkit.bloodPressure.component.diastolic': '이완기',
  'healthkit.bloodPressure.measurementTime': '측정 시각: {timestamp}',
  'healthkit.bloodPressure.source': '출처: {source}',
  'healthkit.bloodPressure.originalAvailable': '원본 표현: {amount} {unit}',
  'healthkit.bloodPressure.originalUnavailable': '원본 정보 제공 안 됨',
  'healthkit.bloodPressure.loading': '저장된 혈압 기록을 불러오는 중…',
  'healthkit.bloodPressure.loadError': '저장된 혈압 기록을 불러오지 못했어요.',
  'healthkit.bloodPressure.retry': '다시 불러오기',
  'healthkit.bloodPressure.empty':
    '저장된 혈압 기록이 없어요. 읽기 허용 여부는 앱에서 확인할 수 없어요.',
  'healthkit.bloodPressure.status.idle':
    '가져오기 버튼을 누르면 HealthKit 확인을 시작해요.',
  'healthkit.bloodPressure.status.importing':
    'HealthKit 혈압 기록을 가져오고 있어요…',
  'healthkit.bloodPressure.status.complete': '가져오기가 끝났어요',
  'healthkit.bloodPressure.status.empty': '새로 반영된 기록이 없어요',
  'healthkit.bloodPressure.status.unavailable': '가져오기를 시작할 수 없어요',
  'healthkit.bloodPressure.status.partial': '일부 변경 사항만 반영했어요',
  'healthkit.bloodPressure.status.failed': '가져오기를 완료하지 못했어요',
  'healthkit.bloodPressure.outcome.complete.title': '가져오기가 끝났어요',
  'healthkit.bloodPressure.outcome.complete.description':
    'HealthKit에서 확인한 혈압 변경 사항을 이 기기의 기록에 반영했어요.',
  'healthkit.bloodPressure.outcome.empty.title': '새로 반영된 기록이 없어요',
  'healthkit.bloodPressure.outcome.empty.description':
    'HealthKit에서 새로 반영할 변경 사항을 받지 못했어요.',
  'healthkit.bloodPressure.outcome.partial.title':
    '일부 변경 사항만 반영했어요',
  'healthkit.bloodPressure.outcome.partial.description':
    '다시 가져오면 나머지 변경 사항도 확인할 수 있어요.',
  'healthkit.bloodPressure.outcome.unavailable.title':
    '가져오기를 시작할 수 없어요',
  'healthkit.bloodPressure.outcome.unavailable.description':
    '이 기기에서 HealthKit 혈압 기록을 가져올 수 없어요.',
  'healthkit.bloodPressure.outcome.failed.title':
    '가져오기를 완료하지 못했어요',
  'healthkit.bloodPressure.outcome.failed.description':
    '다시 시도할 수 있어요.',
} as const;

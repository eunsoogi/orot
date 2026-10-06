// Keep HealthKit source limitations explicit in the user-visible blood-pressure record view.
export const bloodPressureKo = {
  'healthkit.bloodPressure.open': '혈압 기록 가져오기',
  'healthkit.bloodPressure.title': '혈압 기록',
  'healthkit.bloodPressure.description':
    'HealthKit에서 가져온 수축기와 이완기 측정값을 확인할 수 있어요.',
  'healthkit.bloodPressure.localOnly':
    '선택한 기록만 이 기기의 암호화된 저장소에 보관해요.',
  'healthkit.bloodPressure.back': '뒤로',
  'healthkit.bloodPressure.import': 'HealthKit 혈압 기록 가져오기',
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
  'healthkit.bloodPressure.status.complete': '혈압 기록 변경을 가져왔어요.',
  'healthkit.bloodPressure.status.empty': '새로운 혈압 기록 변경이 없어요.',
  'healthkit.bloodPressure.status.unavailable':
    'HealthKit을 사용할 수 없거나 혈압 기록 유형을 지원하지 않아요.',
  'healthkit.bloodPressure.status.partial': '일부 혈압 기록만 가져왔어요.',
  'healthkit.bloodPressure.status.failed':
    '혈압 기록을 가져오지 못했어요. 다시 시도해 주세요.',
} as const;

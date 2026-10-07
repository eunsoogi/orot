// Keeps authorization uncertainty and provider-specific outcomes explicit in the combined screen.
export const healthkitUnifiedImportKo = {
  'healthkit.unifiedImport.open': '건강 기록 및 캘린더 가져오기',
  'healthkit.unifiedImport.title': 'HealthKit 및 캘린더 가져오기',
  'healthkit.unifiedImport.description':
    '가져올 건강 기록 유형과 다가오는 캘린더 일정을 선택해 주세요.',
  'healthkit.unifiedImport.calendarLabel': '다가오는 캘린더 일정',
  'healthkit.unifiedImport.eventKitCancelled': '캘린더 일정 확인이 취소됐어요.',
  'healthkit.unifiedImport.localOnly':
    '건강 기록은 이 기기의 암호화 저장소에 보관하고, 직접 확인한 캘린더 일정만 저장해요.',
  'healthkit.unifiedImport.readAuthorization':
    'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요.',
  'healthkit.unifiedImport.back': '뒤로',
  'healthkit.unifiedImport.import': '선택 항목 가져오기',
  'healthkit.unifiedImport.cancel': '가져오기 취소',
  'healthkit.unifiedImport.feature.medications': '약 및 복용 기록',
  'healthkit.unifiedImport.feature.bloodPressure': '혈압',
  'healthkit.unifiedImport.feature.sleep': '수면',
  'healthkit.unifiedImport.feature.heartRate': '심박수',
  'healthkit.unifiedImport.feature.steps': '걸음 수',
  'healthkit.unifiedImport.feature.bodyMass': '체중',
  'healthkit.unifiedImport.featureStatus.notSelected': '선택되지 않음',
  'healthkit.unifiedImport.featureStatus.waitingAuthorization':
    '권한 요청 대기',
  'healthkit.unifiedImport.featureStatus.ready': '가져올 준비됨',
  'healthkit.unifiedImport.featureStatus.querying': '기록 확인 중…',
  'healthkit.unifiedImport.featureStatus.persisting': '저장 중…',
  'healthkit.unifiedImport.featureStatus.complete': '완료',
  'healthkit.unifiedImport.featureStatus.empty': '새 변경 없음',
  'healthkit.unifiedImport.featureStatus.partial': '일부만 완료',
  'healthkit.unifiedImport.featureStatus.unsupportedFeature':
    '이 기기에서 지원되지 않음',
  'healthkit.unifiedImport.featureStatus.unsupportedPlatform':
    '이 플랫폼에서 지원되지 않음',
  'healthkit.unifiedImport.featureStatus.unavailable':
    'HealthKit을 사용할 수 없음',
  'healthkit.unifiedImport.featureStatus.unsupportedData':
    '처리할 수 없는 데이터',
  'healthkit.unifiedImport.featureStatus.notRun': '실행되지 않음',
  'healthkit.unifiedImport.featureStatus.failed': '실패',
  'healthkit.unifiedImport.featureStatus.cancelled': '취소됨',
  'healthkit.unifiedImport.phase.queued': '대기 중',
  'healthkit.unifiedImport.phase.authorizingHealthKit':
    'HealthKit 권한 확인 중…',
  'healthkit.unifiedImport.phase.authorizingEventKit': '캘린더 권한 확인 중…',
  'healthkit.unifiedImport.phase.preparingStorage': '기록 저장소 준비 중…',
  'healthkit.unifiedImport.phase.querying': '선택한 건강 기록 확인 중…',
  'healthkit.unifiedImport.phase.queryingEventKit': '캘린더 일정 확인 중…',
  'healthkit.unifiedImport.phase.cancelling': '가져오기 취소 중…',
  'healthkit.unifiedImport.phase.complete': '가져오기를 완료했어요.',
  'healthkit.unifiedImport.phase.empty': '새로운 변경이 없어요.',
  'healthkit.unifiedImport.phase.partial': '일부 항목만 가져왔어요.',
  'healthkit.unifiedImport.phase.failed':
    '가져오지 못했어요. 다시 시도해 주세요.',
  'healthkit.unifiedImport.phase.cancelled': '가져오기를 취소했어요.',
  'healthkit.unifiedImport.changeSummary':
    '{imported}개 저장 · {deleted}개 삭제',
} as const;

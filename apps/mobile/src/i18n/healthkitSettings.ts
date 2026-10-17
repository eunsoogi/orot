export const healthkitSettingsKo = {
  'settings.integrations': '연동',
  'settings.healthData': '건강 데이터',
  'settings.healthDataSummary': '앱을 열 때 자동으로 동기화해요.',
  'settings.syncStatus': '권한 및 동기화 상태',
  'settings.syncStatusSummary': '문제가 있으면 상태를 확인하고 다시 시도해요.',
  'settings.otherSettings': '기타 설정',
  'settings.dataManagement': '데이터 관리',
  'settings.healthData.title': '건강 데이터',
  'settings.healthData.description':
    '자동으로 동기화할 건강 기록을 선택해 주세요. 앱을 열거나 다시 실행하면 새 기록을 확인해요.',
  'settings.healthData.localOnly':
    '선택한 기록은 이 기기의 암호화된 저장소에 보관하며 AI 제공자에게 자동 전송하지 않아요.',
  'settings.healthData.permissionNote':
    'HealthKit 읽기 허용 여부는 앱에서 확인할 수 없어요. 기록이 보이지 않으면 iOS 설정에서 권한을 확인해 주세요.',
  'settings.healthData.save': '자동 동기화 설정 저장',
  'settings.healthData.saving': '설정 저장 중…',
  'settings.healthData.saved': '자동 동기화 설정을 저장했어요.',
  'settings.healthData.retryable':
    '설정은 저장했지만 동기화하지 못했어요. 권한 및 동기화 상태에서 확인해 주세요.',
  'settings.healthData.disabled': '자동 동기화를 껐어요.',
  'settings.healthData.loading': '저장한 동기화 설정을 불러오는 중…',
  'settings.healthData.loadError': '저장한 설정을 불러오지 못했어요.',
  'settings.syncStatus.title': '권한 및 동기화 상태',
  'settings.syncStatus.healthData': '건강 기록',
  'settings.syncStatus.noSelection':
    '자동 동기화할 건강 기록이 선택되지 않았어요.',
  'settings.syncStatus.noResult': '아직 자동 동기화를 실행하지 않았어요.',
  'settings.syncStatus.complete': '마지막 동기화에서 선택한 기록을 확인했어요.',
  'settings.syncStatus.retryable':
    '마지막 동기화 중 문제가 있었어요. 권한과 저장소 상태를 확인한 뒤 다시 시도해 주세요.',
  'settings.syncStatus.updatedAt': '마지막 확인: {timestamp}',
  'settings.syncStatus.retry': '지금 다시 동기화',
  'settings.syncStatus.retrying': '동기화 중…',
  'settings.syncStatus.openSettings': 'iOS 설정에서 권한 확인',
  'settings.syncStatus.openSettingsError':
    'iOS 설정을 열지 못했어요. 설정 앱에서 오롯의 권한을 확인해 주세요.',
  'settings.syncStatus.loadError': '동기화 상태를 불러오지 못했어요.',
  'settings.syncStatus.calendar': '캘린더',
  'settings.syncStatus.calendar.loading': '캘린더 일정을 확인하는 중…',
  'settings.syncStatus.calendar.notChecked':
    '아직 캘린더 접근을 확인하지 않았어요.',
  'settings.syncStatus.calendar.fullAccess':
    '캘린더 일정 자동 확인이 켜져 있어요.',
  'settings.syncStatus.calendar.writeOnly':
    '일정을 읽으려면 캘린더 읽기 권한이 필요해요.',
  'settings.syncStatus.calendar.notDetermined':
    '캘린더 접근을 허용하면 일정을 자동으로 확인해요.',
  'settings.syncStatus.calendar.denied':
    '캘린더 접근이 꺼져 있어요. iOS 설정에서 권한을 바꿔 주세요.',
  'settings.syncStatus.calendar.restricted':
    '이 기기에서는 캘린더에 접근할 수 없어요.',
  'settings.syncStatus.calendar.error':
    '캘린더 일정을 확인하지 못했어요. 권한을 확인한 뒤 다시 시도해 주세요.',
  'settings.syncStatus.calendar.updatedAt': '마지막 확인: {timestamp}',
  'settings.syncStatus.calendar.requestAccess': '캘린더 접근 허용',
  'settings.syncStatus.calendar.requestingAccess': '권한 요청 중…',
  'settings.syncStatus.calendar.refresh': '캘린더 일정 다시 확인',
  'settings.syncStatus.calendar.refreshing': '일정 확인 중…',
} as const;

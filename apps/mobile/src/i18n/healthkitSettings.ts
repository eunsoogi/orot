import { dailyReportFailuresKo } from './dailyReportFailuresKo';
import { dailyReportCoverageKo } from './dailyReportCoverageKo';

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
  'settings.healthData.autoSyncEnabled': '자동 동기화 켜짐',
  'settings.healthData.autoSyncDisabled': '자동 동기화 꺼짐',
  'settings.healthData.connection': '건강 앱 연결 상태',
  'settings.healthData.connectionAvailable':
    '이 기기에서 건강 앱 기록을 사용할 수 있어요.',
  'settings.healthData.connectionUnavailable':
    '이 기기에서 건강 앱 기록을 사용할 수 없어요.',
  'settings.healthData.connectionUnknown':
    '건강 앱 기록 상태를 확인하지 못했어요.',
  'settings.healthData.lastSync': '최근 동기화',
  'settings.healthData.statusLoading': '연동 상태를 확인하는 중…',
  'settings.healthData.statusLoadError': '연동 상태를 모두 확인하지 못했어요.',
  'settings.healthData.localOnly':
    '선택한 기록은 이 기기의 암호화된 저장소에 보관하며 AI 제공자에게 자동 전송하지 않아요.',
  'settings.healthData.permissionNote':
    '건강 앱에서 읽기를 허용했는지는 앱에서 확인할 수 없어요. 권한 화면이 다시 뜨지 않으면 건강 앱에서 프로필 > 개인정보 보호 > 앱 > 오롯을 확인한 뒤 돌아와 다시 저장해 주세요.',
  'settings.healthData.save': '자동 동기화 설정 저장',
  'settings.healthData.saving': '설정 저장 중…',
  'settings.healthData.saved': '자동 동기화 설정을 저장했어요.',
  'settings.healthData.selectionSaveFailed':
    '선택한 자동 동기화 설정을 저장하지 못했어요. 다시 시도해 주세요.',
  'settings.healthData.retryable':
    '설정은 저장했지만 동기화하지 못했어요. 권한 및 동기화 상태에서 확인해 주세요.',
  'settings.healthData.authorizationUnavailable':
    '이 기기에서 건강 기록을 사용할 수 없어 권한 요청을 시작하지 못했어요. 건강 앱을 확인한 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationUnsupportedFeature':
    '선택한 항목 중 이 기기에서 요청할 수 없는 항목이 있어요. 항목을 확인한 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationStandardRequestFailed':
    '건강 기록 권한 요청을 완료하지 못했어요. 건강 앱에서 프로필 > 개인정보 보호 > 앱 > 오롯을 확인한 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationMedicationRequestFailed':
    '복약 기록 권한 요청을 완료하지 못했어요. 건강 앱에서 프로필 > 개인정보 보호 > 앱 > 오롯을 확인한 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationPresentationFailed':
    '복약 권한 화면을 열지 못했어요. 열린 시스템 화면을 닫은 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationRequestFailed':
    '건강 기록 권한 요청을 마치지 못했어요. 건강 앱에서 프로필 > 개인정보 보호 > 앱 > 오롯을 확인한 뒤 다시 저장해 주세요.',
  'settings.healthData.authorizationDiagnostic':
    '확인 단계: {stage}, 결과: {code}',
  'settings.healthData.authorizationDiagnostic.stage.availability':
    '기기 상태 확인',
  'settings.healthData.authorizationDiagnostic.stage.standardRequest':
    '건강 기록 권한 요청',
  'settings.healthData.authorizationDiagnostic.stage.medicationRequest':
    '복약 기록 권한 요청',
  'settings.healthData.authorizationDiagnostic.stage.presentation':
    '권한 화면 표시',
  'settings.healthData.authorizationDiagnostic.stage.authorization':
    '권한 요청',
  'settings.healthData.authorizationDiagnostic.code.healthDataUnavailable':
    '건강 기록을 사용할 수 없음',
  'settings.healthData.authorizationDiagnostic.code.unsupportedFeature':
    '선택한 기록 유형을 지원하지 않음',
  'settings.healthData.authorizationDiagnostic.code.requestFailed':
    '권한 요청을 완료하지 못함',
  'settings.healthData.authorizationDiagnostic.code.presentationUnavailable':
    '권한 화면을 열지 못함',
  'settings.healthData.disabled': '자동 동기화를 껐어요.',
  'settings.healthData.loading': '저장한 동기화 설정을 불러오는 중…',
  'settings.healthData.loadError': '저장한 설정을 불러오지 못했어요.',
  'settings.dailyReminder.title': '일일 보고서 알림',
  'dailyReminder.openTitle': '오늘의 기록',
  'dailyReminder.openError':
    '이 알림을 열 수 없어요. 앱에서 다시 확인해 주세요.',
  'dailyReport.symptom': '증상: {description}{severity}, 상태: {status}',
  'dailyReport.severity': ' (정도 {severity}/10)',
  'dailyReport.dose': '복약 기록: {kind}{status}{dose}',
  'dailyReport.doseStatus': ', 상태: {status}',
  'dailyReport.doseAmount': ', 용량: {amount} {unit}',
  'dailyReport.fact': '{detail} · 시각: {time} · 출처: {source} ({origin})',
  'dailyReport.title': '일일 보고서',
  'dailyReport.back': '뒤로',
  'dailyReport.backAccessibility': '이전 화면으로 돌아가기',
  'dailyReport.date': '{date} · {zone}',
  'dailyReport.reminderZone':
    '알림을 확인한 시점의 시간대예요. 알림이 전달된 당시의 시간대는 확인할 수 없어요.',
  'dailyReport.preparing': '기록과 저장된 보고서를 확인하고 있어요.',
  'dailyReport.preview': '{time}까지 확인한 기록 {count}건',
  'dailyReport.latest': '가장 최근 기록 시각: {time}',
  'dailyReport.partial':
    '오늘이 끝나기 전까지의 기록이에요. 이후 기록은 포함되지 않아요.',
  'dailyReport.coverage':
    '자료의 동기화 상태와 누락 여부는 확인되지 않았어요. 확인된 기록만 사용해요.',
  'dailyReport.source.health': '건강 측정',
  'dailyReport.source.symptom': '증상',
  'dailyReport.source.dose': '복약',
  'dailyReport.source.calendar': '하루 범위',
  'dailyReport.source.selection': '보고서에 고른 기록',
  'dailyReport.source.conflict': '서로 다른 기록',
  'dailyReport.source.other': '기타 자료',
  'dailyReport.status.available': '확인됨',
  'dailyReport.status.empty': '확인된 기록 없음',
  'dailyReport.status.partial': '일부만 포함',
  'dailyReport.status.stale': '최신 상태 확인 필요',
  'dailyReport.status.failed': '확인 실패',
  'dailyReport.status.unknown': '동기화 상태 미확인',
  ...dailyReportCoverageKo,
  'dailyReport.limit.partial':
    '자료가 많거나 범위가 제한되어 일부 기록만 포함됐을 수 있어요.',
  'dailyReport.limit.sync': '원본 자료가 최신인지 확인되지 않았어요.',
  'dailyReport.limit.medication': '복약 기록의 약 이름은 확인하지 않았어요.',
  'dailyReport.limit.selection': '확인된 기록 중 일부를 골랐어요.',
  'dailyReport.limit.conflict':
    '같은 시각에 서로 다른 기록이나 비교할 수 없는 단위가 있어요.',
  'dailyReport.limit.other': '자료에 추가 제한이 있어요.',
  'dailyReport.sourceTime': '자료 확인 기준: {time}',
  'dailyReport.sources': '기록 출처 확인',
  'dailyReport.sourceLink': '기록 출처 {number} 열기',
  'dailyReport.sourceError':
    '기록이 바뀌었거나 출처를 확인하지 못했어요. 보고서를 다시 확인해 주세요.',
  'dailyReport.empty':
    '이 날짜에 사용할 기록을 찾지 못했어요. 건강 기록을 확인하거나 가져온 뒤 다시 시도해 주세요.',
  'dailyReport.consent':
    '선택한 외부 AI로 기록을 보내야 할 때에는 요청을 확인하고 동의를 받아요.',
  'dailyReport.generate': '오늘 요약하기',
  'dailyReport.regenerate': '다시 요약하기',
  'dailyReport.selectToday': '오늘 선택하기',
  'dailyReport.selectionError':
    '선택한 날짜를 저장하지 못했어요. 다시 시도해 주세요.',
  'dailyReport.loading': '보고서를 만들고 있어요.',
  'dailyReport.cancel': '생성 취소',
  'dailyReport.failure':
    '요청을 완료하지 못했어요. 잠시 후 다시 요약해 주세요.',
  ...dailyReportFailuresKo,
  'dailyReport.cancelled': '보고서 생성을 취소했어요.',
  'dailyReport.stale':
    '기록이 바뀌어 저장된 보고서를 표시할 수 없어요. 오늘을 선택해 다시 요약할 수 있어요.',
  'dailyReport.deleted':
    '저장된 보고서를 찾을 수 없어요. 보고서나 출처 기록이 삭제되었을 수 있어요.',
  'dailyReport.deletedSource':
    '보고서의 출처 기록이 삭제되어 저장된 내용을 표시할 수 없어요.',
  'dailyReport.missingOld':
    '이 날짜에 저장된 보고서가 없어요. 오늘을 선택해 새로운 보고서를 만들 수 있어요.',
  'dailyReport.lookupError':
    '저장된 보고서를 확인하지 못했어요. 다시 시도해 주세요.',
  'dailyReport.retry': '다시 확인',
  'dailyReport.generatedAt': '생성 시각: {time}',
  'dailyReport.savedRevision': '저장된 버전 {revision}',
  'dailyReport.reportCutoff': '기록 확인 기준 시각: {time}',
  'dailyReport.observations': '확인된 기록',
  'dailyReport.supportedContext': '오늘 건강 요약',
  'dailyReport.suggestedQuestions': 'AI가 제안한 질문',
  'dailyReport.reportCaution':
    'AI가 고른 기록이며, 독립적인 의학적 사실이나 진단이 아니에요.',
  'dailyReport.chat': '이 보고서에 관해 대화하기',
  'dailyReport.chatNote': '보고서 내용은 대화에 자동으로 전달되지 않아요.',
  'dailyReport.followUpIdentity': '선택한 보고서: {date} · {zone}',
  'dailyReport.openFromChat': '오늘의 보고서 요청하기',
  'dailyReport.useLatestSaved': '최신 저장 보고서 연결하기',
  'dailyReport.entryError':
    '보고서 화면을 열지 못했어요. 잠시 후 다시 시도해 주세요.',
  'conversationIntent.healthSummary':
    '최근 건강 기록을 날짜와 근거 출처와 함께 요약해 주세요.',
  'conversationIntent.possibilities':
    '건강 기록에서 검토할 가능성을 지지·반대 근거와 불확실성을 구분해 설명해 주세요.',
  'conversationIntent.visitQuestions':
    '다음 진료에서 물어볼 질문을 기록과 근거를 바탕으로 준비해 주세요.',
  'conversationIntent.medicalLiterature':
    '관련 의학 문헌을 찾아 출처를 확인할 수 있게 설명해 주세요.',
  'conversationIntent.useSuggestion': '추천 질문 사용: {question}',
  'settings.dailyReminder.description':
    '원하는 시각을 정해 매일 알림을 받을 수 있어요. 알림에는 건강 정보가 포함되지 않고, 알림을 열어도 AI가 자동으로 실행되지 않아요.',
  'settings.dailyReminder.enabled': '일일 보고서 알림 켜기',
  'settings.dailyReminder.toggleHint':
    '저장한 시간에 매일 알림을 예약해요. 알림 권한은 직접 켤 때만 요청해요.',
  'settings.dailyReminder.time': '알림 시간',
  'settings.dailyReminder.chooseTime': '시간 선택',
  'settings.dailyReminder.changeTime': '변경',
  'settings.dailyReminder.changeTimeAccessibility':
    '알림 시간 {time}. 바꾸려면 탭하세요.',
  'settings.dailyReminder.timeHint': '알림을 받을 현지 시각을 고르고 저장해요.',
  'settings.dailyReminder.loading': '저장한 알림 설정과 권한을 확인하는 중…',
  'settings.dailyReminder.saving': '알림 설정 저장 중…',
  'settings.dailyReminder.loadError': '저장한 알림 설정을 불러오지 못했어요.',
  'settings.dailyReminder.saveError':
    '설정이 저장됐는지 확인하지 못했어요. 다시 시도해 주세요.',
  'settings.dailyReminder.disabled': '일일 보고서 알림이 꺼져 있어요.',
  'settings.dailyReminder.scheduled': '매일 {time} 알림을 예약했어요.',
  'settings.dailyReminder.deliveryNote':
    'iOS는 알림을 선택한 시각에 정확히 전달한다고 보장하지 않아요.',
  'settings.dailyReminder.denied':
    '설정은 저장했지만 알림 권한이 꺼져 있어 예약하지 못했어요.',
  'settings.dailyReminder.authorizationUnknown':
    '알림 권한 상태를 확인하지 못했어요. iOS 설정에서 권한을 확인한 뒤 다시 시도해 주세요.',
  'settings.dailyReminder.scheduleError':
    '알림을 예약하지 못했어요. 시간을 바꾸거나 다시 시도해 주세요.',
  'settings.dailyReminder.openSettings': 'iOS 설정에서 알림 권한 확인',
  'settings.dailyReminder.retry': '다시 시도',
  'settings.dailyReminder.pickerTitle': '알림 시간 선택',
  'settings.dailyReminder.cancel': '취소',
  'settings.dailyReminder.saveTime': '시간 저장',
  'settings.dailyReminder.enableWithTime': '시간을 저장하고 알림 켜기',
  'settings.syncStatus.title': '권한 및 동기화 상태',
  'settings.syncStatus.healthData': '건강 기록',
  'settings.syncStatus.noSelection':
    '자동 동기화할 건강 기록이 선택되지 않았어요.',
  'settings.syncStatus.noResult': '아직 자동 동기화를 실행하지 않았어요.',
  'settings.syncStatus.complete': '마지막 동기화에서 선택한 기록을 확인했어요.',
  'settings.syncStatus.retryable':
    '마지막 동기화 중 문제가 있었어요. 권한과 저장소 상태를 확인한 뒤 다시 시도해 주세요.',
  'settings.syncStatus.skipped':
    '이번 시도에서는 선택한 기록을 확인하지 않았어요. 선택 상태를 확인해 주세요.',
  'settings.syncStatus.attemptedFeatures':
    '이번 시도에서 확인한 항목: {features}',
  'settings.syncStatus.readbackError':
    '시도 결과는 확인했지만 저장된 상태를 다시 읽지 못했어요.',
  'settings.syncStatus.recovery': '복구 작업',
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

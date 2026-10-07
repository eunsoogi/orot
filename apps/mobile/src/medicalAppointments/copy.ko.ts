/** Korean copy keeps this feature independent from the calendar owner's shared catalog. */
export const medicalAppointmentCopy = {
  title: '진료 일정 분류',
  description: 'AI 분류를 검토하고 원하는 일정을 직접 선택할 수 있습니다.',
  queryLimit: '캘린더에서 향후 1년의 일정을 최대 100건까지 불러옵니다.',
  incompleteCalendar:
    '추가 일정 여부를 확인할 수 없어 전체 캘린더를 분류한 결과가 아닙니다.',
  localNotice:
    '선택한 온디바이스 모델은 일정 제목과 시간을 기기에서 처리합니다.',
  remoteNotice:
    '원격 제공자를 선택하면 일정 제목과 시간은 별도 동의 후 전송됩니다.',
  loadCalendar: '캘린더 일정 불러오기',
  classify: '선택한 AI로 분류',
  manual: '수동 입력 및 일정 편집',
  loading: '캘린더 일정을 불러오는 중입니다.',
  classifying: '일정을 분류하고 있습니다.',
  noCandidates: '불러온 일정이 없습니다.',
  permissionUnavailable:
    '캘린더 읽기 권한을 사용할 수 없습니다. 직접 일정을 입력할 수 있습니다.',
  providerUnavailable:
    '선택된 AI를 사용할 수 없습니다. 수동으로 일정을 확인할 수 있습니다.',
  noProvider: 'AI를 분류에 사용하려면 선택한 제공자와 실행 정보가 필요합니다.',
  emptyCoverage: '불러온 후보가 없어 전체 캘린더를 확인했다고 볼 수 없습니다.',
  manualReview:
    'AI 결과를 사용할 수 없어 분류하지 않았습니다. 직접 확인해 주세요.',
  notClassified: '아직 분류하지 않았습니다.',
  save: '의료 일정으로 직접 선택',
  saving: '저장 중입니다.',
  saved: '일정을 저장했습니다.',
  stale: '일정이나 권한이 바뀌었습니다. 다시 불러온 뒤 확인해 주세요.',
  saveError: '일정을 저장하지 못했습니다.',
  resultNotice: '분류 결과는 참고용이며 진단이나 의료 조언이 아닙니다.',
  uncertainty: '불확실성',
  reason: '분류 근거',
  unclassified: '미분류',
  coverage: (returned: number, classified: number) =>
    `불러온 일정 ${returned}건 중 ${classified}건을 분류했습니다.`,
  labels: {
    medical: '진료 일정',
    non_medical: '진료 일정 아님',
    uncertain: '불확실',
    low: '낮음',
    medium: '보통',
    high: '높음',
  },
} as const;

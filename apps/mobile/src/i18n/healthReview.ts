/** Feature-owned wording keeps clinical guidance separate from model-generated observations. */
export const healthReviewText = {
  title: '건강 검토',
  entry: '최근 건강 변화 검토',
  name: '검토 이름',
  scope:
    '최근 30일의 측정·증상 추이와 개수가 제한된 최근 건강 기록을 함께 살펴봐요. 최근 기록 요약에는 30일보다 오래된 자료도 포함될 수 있어요.',
  privacy:
    '검토 이름은 요청을 구분하기 위해 기기에 저장하며 AI에게 보내지 않아요. 생성된 검토 내용은 앱을 다시 시작하면 복원되지 않아요.',
  fresh: '새 검토 시작',
  continue: '입력한 정보로 계속',
  cancel: '검토 취소',
  progress: '건강 검토를 진행하고 있어요.',
  remove: '검토 요청 삭제',
  removeDetail:
    '이 요청과 연결된 대기 상태를 삭제해요. 가져온 건강 기록은 유지돼요.',
  requests: '저장된 검토 요청',
  pending: '추가 정보 대기',
  terminal: '완료 또는 복원할 대기 상태 없음',
  unknown: '알 수 없음',
  population: '대상 정보',
  context: '혈압 측정 상황',
  symptoms: '현재 증상 확인',
  visit: '예정된 진료',
  reading: '혈압 입력 (선택)',
  systolic: '수축기 혈압 (mmHg)',
  diastolic: '이완기 혈압 (mmHg)',
  measuredAt: '측정 시각',
  chooseTime: '날짜와 시간 선택',
  done: '완료',
  cancelPicker: '취소',
  source: '측정 출처 (사용한 기기 등)',
  repeat: '반복 측정 추가',
  inputError:
    '검토 이름과 입력 내용을 확인해 주세요. 혈압은 수치·시각·출처를 모두 입력해야 해요.',
  storageError:
    '검토 요청을 불러오거나 처리하지 못했어요. 저장된 요청을 다시 확인해 주세요.',
  provider: '사용할 AI 확인',
  providerUnavailable:
    '선택한 AI를 사용할 수 없어요. 제공자와 모델을 확인해 주세요.',
  denied: '외부 전송을 승인하지 않아 AI 요청을 보내지 않았어요.',
  safety: '먼저 확인할 안전 안내',
  missing: '확인할 정보',
  observations: '기록에서 관찰한 변화',
  unresolved: '아직 확인할 항목',
  questions: '확인할 질문',
  citation: '근거 살펴보기',
  missingInputs: {
    explicit_symptom_assessment: '현재 증상 여부',
    scheduled_visit: '예정된 진료 여부',
    blood_pressure_reading: '혈압 측정 기록',
    valid_mmHg_reading_with_time_and_source: '단위·시각·출처가 확인된 혈압',
    safety_context: '안전 판단에 필요한 정보',
    adult_non_pregnant_applicability: '성인·임신 여부',
    current_measurement_context: '현재 측정인지 여부',
    health_trends_and_personal_records: '건강 추이와 건강 기록의 충분한 근거',
  },
  outcomes: {
    needs_clarification:
      '추가 정보가 필요해요. 아래 내용을 확인하고 직접 입력해 주세요.',
    safety_action: 'AI 검토보다 먼저 아래 안전 안내를 확인해 주세요.',
    unavailable:
      '이 요청은 지금 검토를 이어갈 수 없어요. 새 검토를 시작해 주세요.',
    cancelled: '검토를 취소했어요.',
    stale_evidence: '근거 기록이 바뀌었거나 삭제되어 검토를 이어갈 수 없어요.',
  },
  actions: {
    seek_immediate_emergency_help: '즉시 응급 서비스에 연락하세요.',
    seek_immediate_emergency_help_if_warning_signs_are_present:
      '위험 증상이 있다면 즉시 응급 서비스에 연락하세요.',
    recheck_measurement_after_60_seconds:
      '최소 60초 뒤 혈압을 다시 측정하고 측정 시각을 입력해 주세요.',
    verify_measurement_data: '측정값과 측정 시각, 출처를 확인해 주세요.',
    confirm_warning_symptoms:
      '위험 증상과 새롭거나 걱정되는 증상이 있는지 확인해 주세요.',
    record_both_readings:
      '처음 측정과 반복 측정의 수치와 시각을 모두 기록해 주세요.',
    contact_clinician_promptly: '의료진에게 신속히 연락하세요.',
    defer_to_scheduled_visit: '예정된 진료에서 확인할 내용을 준비하세요.',
    provide_required_information:
      '판단에 필요한 정보를 확인해 주세요. 알 수 없는 정보는 그대로 남겨 주세요.',
  },
} as const;

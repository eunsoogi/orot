export const fieldLabels: Record<string, string> = {
  amount: '수치',
  medicationName: '약 이름',
  dosageInstruction: '복용 방법',
  route: '투여 경로',
  assertionKind: '복용 정보 유형',
  endsAt: '종료 시각',
  displayText: '표시 이름',
  generalForm: '약 형태',
  nickname: '별칭',
  isArchived: '보관됨',
  hasSchedule: '복용 일정 있음',
  eventKind: '복용 기록 유형',
  observationStatus: '복용 기록 상태',
  scheduleType: '복용 일정 유형',
  dose: '기록된 복용량',
  clinicLabel: '진료 장소',
  note: '메모',
  calendarEventSnapshot: '일정 내용',
  timeZoneIdentifier: '일정 시간대',
  isAllDay: '종일 일정',
  questionText: '진료 질문',
  rationale: '질문 이유',
  priority: '중요도',
  productType: '기기 유형',
  summary: '내용 요약',
  name: '이름',
  notes: '메모',
  question: '질문',
  status: '상태',
  reason: '이유',
  startedAt: '시작 시각',
  scheduledAt: '예정 시각',
  durationMinutes: '시간(분)',
  recordingDurationMs: '녹음 길이',
  manufacturer: '제조사',
  model: '기기',
  device: '기기 정보',
  encounterKind: '진료 유형',
  bodySite: '부위',
  concept: '항목',
  createdAt: '저장 시각',
  description: '내용',
  effectiveAt: '발생 시각',
  endedAt: '종료 시각',
  ingestedAt: '앱 저장 시각',
  kind: '종류',
  language: '언어',
  observationKind: '기록 유형',
  origin: '기록 경로',
  pageNumber: '페이지',
  publicationDate: '발행일',
  recordedAt: '기록 시각',
  resolvedAt: '해결 시각',
  reviewState: '검토 상태',
  severity: '정도',
  sourceKind: '출처 유형',
  sourceName: '출처 이름',
  sourceRepresentation: '출처에 기록된 값',
  sourceVersion: '출처 버전',
  system: '출처 시스템',
  text: '원문',
  title: '제목',
  unit: '단위',
  value: '값',
};

const enumLabels: Record<string, Record<string, string>> = {
  concept: {
    'blood pressure systolic': '수축기 혈압',
    'blood pressure diastolic': '이완기 혈압',
    blood_pressure_systolic: '수축기 혈압',
    blood_pressure_diastolic: '이완기 혈압',
    heart_rate: '심박수',
    step_count: '걸음 수',
    body_mass: '체중',
    weight: '체중',
    HKCategoryTypeIdentifierSleepAnalysis: '수면',
    sleep: '수면',
  },
  assertionKind: {
    prescribed: '처방 기록',
    current_medication_confirmation: '현재 복용 확인',
  },
  eventKind: {
    taken: '복용함',
    missed: '복용하지 못함',
    administered: '투여함',
    observed: '가져온 복용 기록',
  },
  observationStatus: {
    not_interacted: '응답 없음',
    notification_not_sent: '알림 미발송',
    snoozed: '나중에 알림',
    taken: '복용함',
    skipped: '건너뜀',
    not_logged: '기록 없음',
    unknown: '알 수 없음',
  },
  scheduleType: { as_needed: '필요할 때', scheduled: '정해진 일정' },
  priority: { routine: '일반', important: '중요' },
  encounterKind: {
    outpatient: '외래',
    urgent_care: '긴급 진료',
    emergency: '응급 진료',
    inpatient: '입원',
    telehealth: '비대면 진료',
    other: '기타',
  },
  kind: {
    boolean: '참 또는 거짓',
    preference: '선호',
    quantity: '수량',
    reviewed_interaction: '검토된 대화',
    task_context: '작업 맥락',
    text: '문자',
  },
  observationKind: {
    allergy: '알레르기',
    diagnosis: '진단 기록',
    measurement: '측정',
    other: '기타',
    procedure: '시술 기록',
  },
  origin: {
    caregiver_reported: '보호자 입력',
    clinician_recorded: '의료진 기록',
    derived: '파생 기록',
    device_recorded: '기기 기록',
    imported: '가져온 기록',
    user_reported: '사용자 입력',
  },
  reviewState: {
    human_reviewed: '사람이 검토함',
    user_confirmed: '사용자 확인',
  },
  sourceKind: {
    audio_recording: '녹음',
    caregiver_note: '보호자 메모',
    clinician_note: '의료진 기록',
    device_export: '기기 내보내기',
    imaging_report: '영상 검사 결과',
    lab_report: '검사 결과',
    other: '기타',
    prescription: '처방전',
    user_note: '사용자 메모',
  },
  status: {
    available: '확인 가능',
    unavailable: '확인할 수 없음',
    scheduled: '예정',
    completed: '완료',
    cancelled: '취소',
    needs_review: '재검토 필요',
    reviewed: '검토됨',
    unreviewed: '미검토',
  },
  system: { healthkit: 'HealthKit' },
};

export function visibleValue(value: unknown, key?: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') {
    if (key?.endsWith('At') && Number.isFinite(Date.parse(value))) {
      // Show the device's local time and zone, rather than silently presenting UTC as local.
      return new Intl.DateTimeFormat('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        timeZoneName: 'short',
      }).format(new Date(value));
    }
    return enumLabels[key ?? '']?.[value] ?? value;
  }
  if (typeof value === 'number') {
    if (key === 'recordingDurationMs') {
      const seconds = Math.floor(value / 1000);
      return `${Math.floor(seconds / 60)}분 ${seconds % 60}초`;
    }
    return String(value);
  }
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  if (Array.isArray(value)) {
    const items = value
      .map(item => visibleValue(item))
      .filter((item): item is string => item !== undefined);
    return items.length ? items.join(', ') : undefined;
  }
  if (typeof value !== 'object') return undefined;
  const record = value as Record<string, unknown>;
  if (
    record.status === 'unavailable' &&
    record.reason === 'healthkit_does_not_expose_original_display_unit'
  ) {
    // A source-display limitation is import bookkeeping, not missing normalized measurement data.
    return undefined;
  }
  if (record.kind === 'text') return visibleValue(record.text);
  if (record.kind === 'boolean') return visibleValue(record.value);
  if (typeof record.amount === 'number' && typeof record.unit === 'string') {
    const original = visibleValue(record.sourceRepresentation);
    return `${record.amount} ${record.unit}${original ? ` (출처에 기록된 값: ${original})` : ''}`;
  }
  // Record IDs support local linkage but do not belong in user-facing summaries.
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(
      ([fieldKey]) => !isPrivateIdentifier(fieldKey) && fieldLabels[fieldKey],
    )
    .map(([fieldKey, item]) => {
      const rendered = visibleValue(item, fieldKey);
      return rendered
        ? `${fieldLabels[fieldKey] ?? fieldKey}: ${rendered}`
        : undefined;
    })
    .filter((item): item is string => item !== undefined);
  return rows.length ? rows.join(' · ') : undefined;
}

export function isPrivateIdentifier(key: string): boolean {
  if (key === 'timeZoneIdentifier') return false;
  return (
    key === 'id' ||
    key.endsWith('Id') ||
    key.endsWith('Ids') ||
    key.endsWith('Identifier') ||
    key === 'contentHash' ||
    key === 'externalReference'
  );
}

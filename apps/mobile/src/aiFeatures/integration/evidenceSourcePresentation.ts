import type { PersistedMemoryRecord } from '@orot/agent-memory';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceSourceDocument } from './evidenceRegistry';

export interface EvidenceSourceDetailRow {
  readonly label: string;
  readonly value: string;
}

export interface EvidenceSourceDetailSection {
  readonly title: string;
  readonly rows: readonly EvidenceSourceDetailRow[];
}

const fieldLabels: Record<string, string> = {
  amount: '수치',
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
    needs_review: '재검토 필요',
    reviewed: '검토됨',
    unreviewed: '미검토',
  },
  system: { healthkit: 'HealthKit' },
};

function visibleValue(value: unknown, key?: string): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'string') return enumLabels[key ?? '']?.[value] ?? value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '예' : '아니요';
  if (Array.isArray(value)) {
    const items = value
      .map(item => visibleValue(item))
      .filter((item): item is string => item !== undefined);
    return items.length ? items.join(', ') : undefined;
  }
  if (typeof value !== 'object') return undefined;
  // Record IDs support local linkage but do not belong in user-facing summaries.
  const rows = Object.entries(value as Record<string, unknown>)
    .filter(([fieldKey]) => !isPrivateIdentifier(fieldKey))
    .map(([fieldKey, item]) => {
      const rendered = visibleValue(item, fieldKey);
      return rendered
        ? `${fieldLabels[fieldKey] ?? fieldKey}: ${rendered}`
        : undefined;
    })
    .filter((item): item is string => item !== undefined);
  return rows.length ? rows.join(' · ') : undefined;
}

function isPrivateIdentifier(key: string): boolean {
  return key === 'id' || key.endsWith('Id') || key.endsWith('Ids');
}

function personalRecordRows(
  entry: LocalHealthEvidenceRecord,
): EvidenceSourceDetailRow[] {
  const record = entry.record as unknown as Record<string, unknown>;
  const rows: EvidenceSourceDetailRow[] = [];
  for (const [key, value] of Object.entries(record)) {
    if (
      isPrivateIdentifier(key) ||
      key === 'provenance' ||
      key === 'reviewState'
    )
      continue;
    const rendered = visibleValue(value, key);
    if (rendered)
      rows.push({ label: fieldLabels[key] ?? key, value: rendered });
  }
  const provenance = record.provenance as
    { origin?: unknown; source?: Record<string, unknown> } | undefined;
  if (provenance?.origin) {
    rows.push({
      label: '기록 경로',
      value:
        visibleValue(provenance.origin, 'origin') ?? String(provenance.origin),
    });
  }
  const source = provenance?.source;
  if (source) {
    const rendered = visibleValue(source);
    if (rendered) rows.push({ label: '출처', value: rendered });
  }
  const reviewState = record.reviewState as { status?: unknown } | undefined;
  if (reviewState?.status) {
    rows.push({
      label: '검토 상태',
      value:
        visibleValue(reviewState.status, 'status') ??
        String(reviewState.status),
    });
  }
  return rows;
}

function recordTitle(entry: LocalHealthEvidenceRecord): string {
  const labels: Partial<Record<LocalHealthEvidenceRecord['kind'], string>> = {
    appointment: '예약 기록',
    dose_event: '복용 기록',
    encounter: '진료 기록',
    evidence_span: '원문 발췌',
    health_observation: '건강 측정',
    medication_assertion: '복용 정보',
    medication_definition: '약 정보',
    source_record: '저장된 출처',
    symptom_entry: '증상 기록',
    transcript_segment: '녹음 전사',
    visit_brief: '진료 요약',
    visit_question: '진료 질문',
  };
  return labels[entry.kind] ?? entry.kind;
}

function memoryRows(record: PersistedMemoryRecord): EvidenceSourceDetailRow[] {
  const meta = record.meta as Record<string, unknown>;
  const provenance = meta.provenance as Record<string, unknown>;
  const sourceDates = Array.isArray(provenance.sourceDates)
    ? provenance.sourceDates
        .map(item => {
          if (!item || typeof item !== 'object') return undefined;
          const date = (item as Record<string, unknown>).date;
          return typeof date === 'string' ? date : undefined;
        })
        .filter((date): date is string => date !== undefined)
    : [];
  return [
    { label: '저장된 내용', value: record.text },
    {
      label: '기억 유형',
      value:
        visibleValue(meta.kind, 'kind') ??
        String(meta.kind ?? '확인할 수 없음'),
    },
    {
      label: '검토 상태',
      value:
        visibleValue(provenance.reviewState, 'reviewState') ??
        String(provenance.reviewState),
    },
    {
      label: '연결된 출처',
      value: `${Array.isArray(provenance.sourceIds) ? provenance.sourceIds.length : 0}개`,
    },
    ...(sourceDates.length
      ? [{ label: '출처 날짜', value: sourceDates.join(', ') }]
      : []),
    {
      label: '저장 시각',
      value: Number.isFinite(record.createdAt)
        ? new Date(record.createdAt).toISOString()
        : '확인할 수 없음',
    },
  ];
}

/** Renders persisted citation sources without exposing opaque local identifiers. */
export function presentEvidenceSource(
  document: EvidenceSourceDocument,
): readonly EvidenceSourceDetailSection[] {
  if (document.sourceKind === 'reviewed_memory') {
    return [{ title: '검토된 기억', rows: memoryRows(document.record) }];
  }
  return document.records.map(entry => ({
    title: recordTitle(entry),
    rows: personalRecordRows(entry),
  }));
}

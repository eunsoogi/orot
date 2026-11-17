import {
  AppointmentSchema,
  DoseEventSchema,
  SymptomEntrySchema,
} from '@orot/domain';
import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../../healthEvidence/localEvidenceQueries';
import { dailyReportActions } from '../dailyReportActions';

const metadata = (id: string) => ({
  id,
  effectiveAt: '2035-01-01T01:00:00Z',
  recordedAt: '2035-01-01T01:00:00Z',
  ingestedAt: '2035-01-01T01:00:00Z',
  provenance: { origin: 'user_reported', sourceRecordIds: [] },
  reviewState: { status: 'unreviewed' },
});
const dose = (eventKind: 'taken' | 'missed'): LocalHealthEvidenceRecord => ({
  kind: 'dose_event',
  record: DoseEventSchema.parse({
    ...metadata(eventKind),
    eventKind,
    medicationAssertionId: 'synthetic-rx',
  }),
});
const visit = (
  status: 'scheduled' | 'cancelled' | 'completed',
): LocalHealthEvidenceRecord => ({
  kind: 'appointment',
  record: AppointmentSchema.parse({ ...metadata('visit'), status }),
});
const summarize = (values: LocalHealthEvidenceRecord[]) =>
  dailyReportActions(
    values,
    values.map(item => ({
      source: item.kind,
      recordId: item.record.id,
      revision: '1',
      occurrence: { startInclusive: item.record.effectiveAt! },
      ingestedAt: item.record.ingestedAt,
    })) as DailyReportSourceRecord[],
  );

test('explicit missed and taken doses remain separate, not an adherence score or dosing instruction', () => {
  const claims = summarize([dose('missed'), dose('taken')]);
  expect(claims[0]?.text).toContain('임의로 보충 복용하거나 용량을 변경하지');
  expect(claims[0]?.sourceReferences).toEqual([
    { source: 'dose_event', recordId: 'missed' },
  ]);
  expect(claims[1]?.text).toContain('복용·투여를 완료했어요');
  expect(claims[1]?.text).toContain('다른 예정 회차');
  expect(claims[1]?.sourceReferences).toEqual([
    { source: 'dose_event', recordId: 'taken' },
  ]);
});
test('a visit and active symptoms support preparation, not attendance, a diagnosis or delay', () => {
  const symptoms: LocalHealthEvidenceRecord = {
    kind: 'symptom_entry',
    record: SymptomEntrySchema.parse({
      ...metadata('symptom'),
      status: 'active',
      description: '합성 증상',
    }),
  };
  const claim = summarize([visit('scheduled'), symptoms])[0]!;
  expect(claim.text).toContain('진료 때까지 증상을 기다리라고 권하지');
  expect(claim.sourceReferences).toHaveLength(2);
});
test('cancelled visits never produce visit preparation; completed is a recorded status', () => {
  expect(summarize([visit('cancelled')])).toHaveLength(1);
  expect(summarize([visit('completed')])[0]?.text).toContain('완료로 저장한');
  expect(summarize([visit('completed')])[0]?.text).toContain(
    '진단이나 새 처방 내용이 확인되지',
  );
});
test('unobserved evidence is not invented and source mismatch is rejected', () => {
  expect(summarize([])).toEqual([]);
  expect(
    summarize([dose('taken')])
      .map(x => x.text)
      .join(' '),
  ).not.toContain('누락 또는');
  expect(() => dailyReportActions([dose('taken')], [])).toThrow(
    'Snapshot source mismatch',
  );
});

test.each([
  'not_interacted',
  'notification_not_sent',
  'snoozed',
  'not_logged',
  'unknown',
])(
  'imported %s status never becomes a missed or taken dose',
  observationStatus => {
    const value: LocalHealthEvidenceRecord = {
      kind: 'dose_event',
      record: DoseEventSchema.parse({
        ...metadata('observed'),
        eventKind: 'observed',
        medicationDefinitionId: 'synthetic-definition',
        observationStatus,
      }),
    };
    const claims = summarize([value]);
    expect(claims[0]?.text).toContain('복용 여부가 확정되지 않은');
    expect(claims[0]?.text).not.toContain('누락 또는 건너뜀');
    expect(claims[0]?.text).not.toContain('복용·투여를 완료했어요');
  },
);

test.each(['taken', 'administered', 'observed'] as const)(
  'explicit %s completion is affirmed rather than questioned',
  eventKind => {
    const value: LocalHealthEvidenceRecord = {
      kind: 'dose_event',
      record: DoseEventSchema.parse({
        ...metadata(eventKind),
        eventKind,
        ...(eventKind === 'observed'
          ? {
              medicationDefinitionId: 'synthetic-definition',
              observationStatus: 'taken',
            }
          : { medicationAssertionId: 'synthetic-rx' }),
      }),
    };
    const claims = summarize([value]);
    expect(claims[0]?.text).toContain('복용·투여를 완료했어요');
    expect(claims[0]?.text).not.toContain('복용 여부가 확정되지');
  },
);

test.each(['absent', 'cancelled'] as const)(
  'offers a source-bound next step for recorded active symptoms with %s visit',
  mode => {
    const symptom: LocalHealthEvidenceRecord = {
      kind: 'symptom_entry',
      record: SymptomEntrySchema.parse({
        ...metadata('ongoing'),
        effectiveAt: '2034-12-20T01:00:00Z',
        status: 'active',
        description: 'Synthetic symptom',
      }),
    };
    const values =
      mode === 'cancelled' ? [visit('cancelled'), symptom] : [symptom];
    const claims = summarize(values);
    expect(claims[0]?.text).toContain('현재도 이어지거나 악화되면');
    expect(claims[0]?.text).toContain(
      '기록만으로 현재 증상이나 원인을 확정하지',
    );
    expect(claims[0]?.text).toContain('기록 정리나 예약을 기다리지');
    expect(claims[0]?.sourceReferences).toEqual([
      { source: 'symptom_entry', recordId: 'ongoing' },
    ]);
    expect(claims.at(-1)?.text).toContain('현재 접근 가능한');
    expect(symptom.record.effectiveAt).toBe('2034-12-20T01:00:00Z');
    const resolved = {
      ...symptom,
      record: { ...symptom.record, status: 'resolved' as const },
    };
    expect(summarize([resolved])).toHaveLength(1);
  },
);

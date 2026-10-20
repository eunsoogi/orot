import type { TaskResponderInput } from '@orot/agent-runtime';
import type { JsonObject } from '@orot/model-runtime';
import { partitionedSymptomSummaryTask as task } from '../partitionedSymptomSummaryTask';
import { symptomSummaryTask } from '../symptomSummaryTask';
import { reference } from '../taskTestSupport';

function input(topic: JsonObject): TaskResponderInput {
  return {
    request: '사용 가능한 기록 전체의 사실 요약',
    resultPartition: { sourceKind: 'personal_record', index: 0, total: 2 },
    evidence: {
      items: [
        {
          ...reference,
          evidenceId: 'facts',
          content: 'health_context: ' + JSON.stringify(topic),
        },
      ],
      coverage: [],
      conflicts: [],
    },
  };
}
function summary(topic: JsonObject, choices: JsonObject) {
  const result = task.validateResult(
    { recordSummaries: { facts: choices } },
    input(topic),
  );
  expect(result.status).toBe('valid');
  if (result.status !== 'valid') throw new Error('Expected source-bound facts');
  return result.value.hypotheses[0].summary;
}

test('retains independent activity sensors and never substitutes latest amount for observation count', () => {
  const topic: JsonObject = {
    topic: 'activity',
    calendarDays: 30,
    quantities: [
      {
        concept: 'step_count',
        unit: 'count',
        sensorSeries: 1,
        sampleCount: 210,
        recordedDays: 29,
        meanRecordedDailySampleSum: 900,
        latest: { amount: 60 },
      },
      {
        concept: 'step_count',
        unit: 'count',
        sensorSeries: 2,
        sampleCount: 24,
        recordedDays: 12,
        meanRecordedDailySampleSum: 700,
      },
    ],
  };
  const text = summary(topic, { q0: 'latest', q1: 'mean' });
  expect(text).toContain('측정 출처 1: 최근 측정 60 걸음');
  expect(text).toContain('측정 210건');
  expect(text).toContain('측정 출처 2: 기록일별 센서 샘플 합 평균 700 걸음');
  expect(text).toContain('측정 24건');
  expect(text).toContain('합산하거나 전체 일일 걸음수로 해석할 수 없어요');
  expect(
    task.validateResult(
      { recordSummaries: { facts: { q0: 'latest' } } },
      input(topic),
    ).status,
  ).toBe('invalid');
});

test('keeps registered medication, confirmed use and recorded doses distinct in either emphasis', () => {
  const topic = {
    topic: 'medications',
    medications: [
      {
        name: '합성 등록약',
        source: 'healthkit_registration',
        taken: 28,
        skipped: 1,
        otherDoseRecords: 0,
        daysWithDoseRecords: 28,
      },
      {
        name: '합성 확인약',
        source: 'current_user_confirmation',
        taken: 0,
        skipped: 0,
        otherDoseRecords: 0,
        daysWithDoseRecords: 0,
      },
    ],
  };
  for (const mode of ['status', 'dose_history']) {
    const text = summary(topic, { m0: mode, m1: mode });
    expect(text).toContain('합성 등록약');
    expect(text).toContain('건강 앱에 등록된 약');
    expect(text).toContain('복용 완료 28건');
    expect(text).toContain('건너뜀 1건');
    expect(text).toContain('합성 확인약');
    expect(text).toContain('직접 확인한 현재 복용약');
    expect(text).not.toContain('처방');
    expect(text).not.toContain('복용 여부');
  }
});

test('sleep mean and optional whole-period stages never imply absent complete-night records', () => {
  const topic = {
    topic: 'sleep',
    calendarDays: 30,
    sleep: {
      meanRecordedDailyMinutes: 420,
      recordedDays: 20,
      stageMinutes: { asleepCore: 5000, asleepREM: 2500 },
    },
  };
  for (const mode of ['mean', 'mean_and_stages']) {
    const text = summary(topic, { sleep: mode });
    expect(text).toContain('평균 420분');
    expect(text).toContain('기록 20일 / 30일');
    expect(text).toContain('완전한 하룻밤 수면 총량을 뜻하지는 않아요');
    expect(text).not.toContain('완전한 밤 수면 기록이 없');
    if (mode === 'mean_and_stages')
      expect(text).toContain(
        '전체 기간의 단계별 누적 시간: 코어 수면 5000분 · 렘 수면 2500분',
      );
  }
});

test('comparison preserves both daily means and coverage rather than calling the difference a total', () => {
  const text = summary(
    {
      topic: 'measurements',
      quantities: [
        {
          concept: 'heart_rate',
          unit: 'bpm',
          sensorSeries: 1,
          meanOfRecordedDailyMeans: 74,
          comparison: {
            previousMean: 72,
            recentMean: 76,
            difference: 4,
            previousRecordedDays: 6,
            recentRecordedDays: 5,
          },
        },
      ],
    },
    { q0: 'comparison' },
  );
  expect(text).toContain(
    '앞선 7일 평균 72 bpm → 최근 7일 평균 76 bpm · 차이 4 bpm · 각 기록 6일 / 5일',
  );
});

test('source period uses its calendar zone and exclusive endpoint without changing saved analysis format', () => {
  const topic = {
    topic: 'measurements',
    period: {
      fromInclusive: '2026-01-01T15:00:00Z',
      toExclusive: '2026-01-03T15:00:00Z',
      timeZone: 'Asia/Seoul',
    },
    partialDates: ['2026-01-03'],
    quantities: [
      { concept: 'heart_rate', unit: 'bpm', meanOfRecordedDailyMeans: 70 },
    ],
  };
  const current = input(topic),
    generated = { recordSummaries: { facts: { q0: 'mean' } } };
  const merged = task.finalResultPartition!.mergeValues([generated], current);
  const accepted = symptomSummaryTask.validateResult(merged, {
    ...current,
    resultPartition: undefined,
  });
  expect(accepted.status).toBe('valid');
  if (accepted.status !== 'valid')
    throw new Error('Expected ordinary saved result');
  const text = accepted.value.hypotheses[0].summary;
  expect(text).toContain('2026. 1. 2. ~ 2026. 1. 3. (Asia/Seoul)');
  expect(text).toContain('일부 날짜는 하루 중 일부만 포함');
  expect(task.taskVersion).not.toBe(symptomSummaryTask.taskVersion);
});

test('does not require an unnamed medication registration as a fabricated source topic', () => {
  const current = input({
    topic: 'medications',
    medications: [{ name: '합성약', source: 'healthkit_registration' }, {}],
  });
  const schema = task.createResultSchema!(current);
  expect(schema).toMatchObject({
    properties: {
      recordSummaries: { properties: { facts: { required: ['m0'] } } },
    },
  });
});

import { serializeAppleRequest } from '../serializeRequest';

test('passes structured health facts once and replaces complete date lists with exact inclusive periods', () => {
  const dates = Array.from(
    { length: 7 },
    (_, index) => `2026-10-0${index + 1}`,
  );
  const facts = {
    topic: 'measurements',
    quantities: [
      {
        concept: 'heart_rate',
        unit: 'count/min',
        minimumSample: 60,
        maximumSample: 100,
        comparison: {
          previousDates: dates,
          recentDates: dates,
          previousRecordedDays: 4,
          recentRecordedDays: 5,
          previousMean: 70,
          recentMean: 75,
          difference: 5,
        },
      },
    ],
    limitations: ['unrecorded_days_are_unknown_not_zero_or_missed_doses'],
  };
  const body = {
    request: '기록을 정리해줘',
    records: [
      {
        evidenceId: 'evidence-1',
        sourceKind: 'personal_record',
        content: 'health_context: ' + JSON.stringify(facts),
      },
    ],
  };
  const content = JSON.stringify(body);
  const result = serializeAppleRequest({
    messages: [{ role: 'user', content }],
  });
  const rendered = JSON.parse(result.prompt.slice('user: '.length));
  expect(rendered.records[0]).toEqual({
    evidenceId: 'evidence-1',
    sourceKind: 'personal_record',
    content: {
      kind: 'health_context',
      facts: {
        ...facts,
        quantities: [
          {
            ...facts.quantities[0],
            comparison: {
              previousPeriod: {
                fromInclusive: dates[0],
                toInclusive: dates[6],
                calendarDays: 7,
              },
              recentPeriod: {
                fromInclusive: dates[0],
                toInclusive: dates[6],
                calendarDays: 7,
              },
              previousRecordedDays: 4,
              recentRecordedDays: 5,
              previousMean: 70,
              recentMean: 75,
              difference: 5,
            },
          },
        ],
      },
    },
  });
  expect(result.prompt.length).toBeLessThan(content.length);
  expect(JSON.stringify(body)).toBe(content);
});

test('preserves nonconsecutive dates, malformed content, free text and unrelated source formats', () => {
  const quantity = {
    comparison: { previousDates: ['2026-10-01', '2026-10-03'] },
  };
  const records = [
    {
      content: 'health_context: ' + JSON.stringify({ quantities: [quantity] }),
    },
    { content: 'health_context: {not-json' },
    { content: 'transcript: {"text":"synthetic"}' },
  ];
  const result = serializeAppleRequest({
    messages: [{ role: 'user', content: JSON.stringify({ records }) }],
  });
  const rendered = JSON.parse(result.prompt.slice('user: '.length));
  expect(rendered.records[0].content.facts.quantities[0]).toEqual(quantity);
  expect(rendered.records.slice(1)).toEqual(records.slice(1));
  expect(
    serializeAppleRequest({
      messages: [{ role: 'user', content: '기록 그대로' }],
    }).prompt,
  ).toBe('user: 기록 그대로');
});

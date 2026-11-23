import { render } from '@testing-library/react-native';
import { NavigationMotionContext } from '../../navigation/NavigationMotionContext';
import { GeneratedReportContent } from '../GeneratedReportContent';
import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';
import { readableHypothesis } from '../../diseaseHypotheses/readableHypothesis';
import { createGeneratedReportReader } from '../readers';
import { generatedReportCopy as copy } from '../text';

test('an exact committed Health Summary stays readable when source hydration is unavailable', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const openData = jest.fn(async () => {
      throw new Error('Synthetic source adapter unavailable');
    });
    const reader = createGeneratedReportReader(f.database, {
      data: openData,
      records: async () => f.repository,
    });
    const row = (await reader.list()).find(item => item.id === f.saved.id)!;
    const read = (selected = row, signal = new AbortController().signal) =>
      reader.read(selected, signal);
    const expected = f.saved.analysis.hypotheses
      .map(readableHypothesis)
      .flatMap(section => [
        section.title,
        section.summary,
        section.uncertainty,
        ...section.missingData,
      ])
      .filter(Boolean);
    expect(expected.length).toBeGreaterThan(0);
    const detail = await read();
    expect(detail).toEqual({
      paragraphs: expected,
      warning: copy.historicalHealthSummary,
    });
    if (!detail) throw new Error('Expected retained content');
    const ui = await render(
      <NavigationMotionContext.Provider value>
        <GeneratedReportContent detail={detail} />
      </NavigationMotionContext.Provider>,
    );
    for (const paragraph of expected)
      expect(ui.getByText(paragraph)).toBeVisible();
    expect(ui.getByText(copy.historicalHealthSummary)).toBeVisible();
    expect(ui.queryByTestId(/^generated-report-source/u)).toBeNull();
    expect(
      await read({ ...row, createdAt: '2030-01-01T12:00:00.000Z' }),
    ).toBeNull();
    expect(await read({ ...row, key: 'summary:other' })).toBeNull();
    expect(await read({ ...row, origin: 'visit' })).toBeNull();
    const cancelled = new AbortController();
    cancelled.abort();
    expect(await read(row, cancelled.signal)).toBeNull();
    expect(openData).toHaveBeenCalledTimes(1);

    // A valid JSON rewrite with the same ID/date shares the historical invalid
    // marker. It is not proof that the original report still occupies this ID.
    await f.database.execute(
      "UPDATE symptom_summary_runs SET result_json=json_set(result_json,'$.analysis.hypotheses[0].summary',?) WHERE id=?",
      ['Synthetic replacement body', row.id],
    );
    expect(await read()).toBeNull();
    expect(openData).toHaveBeenCalledTimes(1);
    await f.repository.delete('health_observation', f.inside.id);
    expect(await read()).toBeNull();
  } finally {
    f.close();
  }
});

test('a source deletion committed while enrichment is pending prevents the old report from appearing', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    let entered!: () => void;
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>(resolve => {
      release = resolve;
    });
    const reader = createGeneratedReportReader(f.database, {
      data: async () => {
        entered();
        await held;
        throw new Error('Synthetic enrichment lost during deletion');
      },
      records: async () => f.repository,
    });
    const row = (await reader.list()).find(item => item.id === f.saved.id)!;
    const reading = reader.read(row, new AbortController().signal);
    await started;
    await f.repository.delete('health_observation', f.inside.id);
    release();
    expect(await reading).toBeNull();
  } finally {
    f.close();
  }
});

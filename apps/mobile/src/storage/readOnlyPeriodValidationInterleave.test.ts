import { healthContextFixture } from '../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import * as reader from '../healthEvidence/healthContext/reader';
import { isPeriodSummarySource } from '../diseaseHypotheses/savedSummaries';
import { createReadOnlyPeriodValidation } from './readOnlyPeriodValidation';

/** A report can resolve after a direct native write; that result must never seed the memo. */
test('a generation change during report validation prevents caching its success', async () => {
  const f = await healthContextFixture();
  const original = reader.readHealthContextReport;
  try {
    const source = f.saved.sources.find(isPeriodSummarySource)!;
    const spy = jest.spyOn(reader, 'readHealthContextReport');
    spy.mockImplementationOnce(async (...args) => {
      const report = await original(...args);
      await f.database.execute(
        "UPDATE health_observations SET payload_json = json_set(payload_json, '$.value.amount', 99) WHERE id = ?",
        [f.inside.id],
      );
      return report;
    });
    await f.database.transaction(async tx => {
      const validate = createReadOnlyPeriodValidation(tx);
      await validate(tx, source, false);
      await expect(validate(tx, source, false)).rejects.toThrow();
      expect(spy).toHaveBeenCalledTimes(2);
    });
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

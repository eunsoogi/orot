import { healthContextFixture } from '../../../aiFeatures/integration/testSupport/healthContextPersistenceFixture';
import { isPeriodSummarySource } from '../../../diseaseHypotheses/savedSummaries';
import { committedPeriodReadOperation } from '../../../storage/committedPeriodReadOperation';
import { beginHealthContextReadOperation } from '../healthContextReadOperation';

// Synthetic SQLite: changing a caller-owned response must not alter the committed cache seed.
test('caller mutation before sharing cannot invalidate unchanged stored lineage', async () => {
  const f = await healthContextFixture();
  const scope = committedPeriodReadOperation(f.database);
  try {
    const source = f.saved.sources.find(isPeriodSummarySource)!;
    const validate = () => scope.run((tx, check) => check(tx, source, false));
    // The source revision was captured before this unrelated presentation-side mutation.
    (f.report.quantities[0]!.days[0]! as { mean: number }).mean = 999;
    const health = beginHealthContextReadOperation(
      f.read,
      undefined,
      scope.reportScope,
    )!;
    try {
      await expect(validate()).resolves.toBeUndefined();
    } finally {
      health.dispose();
    }
  } finally {
    scope.dispose();
    f.close();
  }
});

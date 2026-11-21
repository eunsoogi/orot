import { boundConversationDigestFixture } from '../testSupport/boundConversationDigestFixture';
import { guardedNativeDatabase } from '../../../storage/protectedReadEpoch';

test('capture uses an independent native witness for both fences, without diagnostics', async () => {
  const f = await boundConversationDigestFixture(guardedNativeDatabase);
  let transactionSamples = 0;
  const roots = f.observeRoots(new Set([f.parent.id]), undefined, async sql => {
    if (sql.includes('pragma_data_version')) transactionSamples++;
  });
  try {
    const refs = Array.from({ length: 12 }, () => f.bind(f.parent));
    const captured = await f.capture(refs);
    expect(captured.mapping.size).toBe(12);
    expect(captured.sources).toHaveLength(1);
    expect(roots.counts).toEqual([f.parent.id, f.parent.id]);
    expect(transactionSamples).toBe(4);
  } finally {
    roots.restore();
    f.close();
  }
});

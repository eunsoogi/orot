import { quarantinedHistoryFixture } from '../../aiFeatures/integration/testSupport/quarantinedHistoryFixture';

test.each(['quarantine', 'delete', 'change', 'hide'] as const)(
  'cached period never replaces current parent checks: %s',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const scope = f.storage.beginReadOperation()!;
    try {
      expect((await scope.readMany(['older']))[0]?.id).toBe('older');
      if (mode === 'quarantine') await f.quarantine();
      if (mode === 'delete')
        await f.database.execute('DELETE FROM health_observations WHERE id=?', [
          f.inside.id,
        ]);
      if (mode === 'change')
        await f.database.execute(
          "UPDATE health_observations SET payload_json=json_set(payload_json, '$.value.amount', 999) WHERE id=?",
          [f.inside.id],
        );
      if (mode === 'hide')
        await f.database.execute(
          "UPDATE conversation_artifact_sessions SET hidden=1 WHERE id='session'",
        );
      expect(await scope.readMany(['older'])).toEqual([null]);
      if (mode === 'quarantine') {
        // Reading withheld metadata must not delete the saved original snapshot.
        expect(
          (
            await f.database.execute(
              'SELECT id FROM symptom_summary_runs WHERE id=?',
              [f.saved.id],
            )
          ).rows,
        ).toHaveLength(1);
      }
    } finally {
      scope.dispose();
      f.close();
    }
  },
);

test('aborted operation rejects before and after a populated cache; disposed aliases are strict', async () => {
  const f = await quarantinedHistoryFixture();
  const controller = new AbortController();
  const scope = f.storage.beginReadOperation(controller.signal)!;
  try {
    await scope.readMany(['older']);
    controller.abort();
    await expect(scope.readMany(['older'])).rejects.toThrow('cancelled');
    const preAborted = f.storage.beginReadOperation(controller.signal)!;
    await expect(preAborted.readMany(['older'])).rejects.toThrow('cancelled');
    preAborted.dispose();
    scope.dispose();
    expect((await scope.readMany(['older']))[0]?.id).toBe('older');
  } finally {
    scope.dispose();
    f.close();
  }
});

test('a custom or foreign read wrapper cannot inherit the original operation authority', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    const custom = { ...f.storage, readMany: async () => [] };
    expect(custom.beginReadOperation()).toBeUndefined();
    const other = await quarantinedHistoryFixture();
    try {
      const mixed = {
        ...f.storage,
        readManyWithAncestry: other.storage.readManyWithAncestry,
      };
      expect(mixed.beginReadOperation()).toBeUndefined();
    } finally {
      other.close();
    }
    const original = f.storage.beginReadOperation()!;
    expect((await original.readMany(['older']))[0]?.id).toBe('older');
    const read = f.storage.readMany;
    const replacement = jest.fn(async () => [null]);
    f.storage.readMany = replacement;
    expect(await original.readMany(['older'])).toEqual([null]);
    expect(replacement).toHaveBeenCalledWith(['older']);
    f.storage.readMany = read;
    original.dispose();
  } finally {
    f.close();
  }
});

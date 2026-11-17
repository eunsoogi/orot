import { quarantinedHistoryFixture } from '../testSupport/quarantinedHistoryFixture';
import { restoreConversationSessionTurns } from '../restoreConversationSessionTurns';

/** Synchronous assembly needs one final fence, not two adjacent expensive snapshots. */
test('keeps pre-assembly and final validation without repeating the same final boundary', async () => {
  const f = await quarantinedHistoryFixture();
  try {
    await f.open();
    const validate = jest.spyOn(f.discovery, 'revalidateSession');
    const restored = await restoreConversationSessionTurns(
      f.input,
      f.open,
      'session',
      new AbortController().signal,
    );
    expect(restored.map(item => item.toolMessageId)).toEqual([
      'older',
      'newer',
    ]);
    expect(validate).toHaveBeenCalledTimes(2);
  } finally {
    jest.restoreAllMocks();
    f.close();
  }
});

test.each(['change', 'delete', 'cancel', 'failure'] as const)(
  'the final assembly fence still rejects %s before publication',
  async mode => {
    const f = await quarantinedHistoryFixture();
    const controller = new AbortController();
    try {
      await f.open();
      const validate = f.discovery.revalidateSession.bind(f.discovery);
      let calls = 0;
      jest
        .spyOn(f.discovery, 'revalidateSession')
        .mockImplementation(async (...args) => {
          if (++calls === 2) {
            if (mode === 'change')
              await f.database.execute(
                "UPDATE conversation_artifacts SET result_json=json_set(result_json,'$.answer','Synthetic changed') WHERE id='older'",
              );
            if (mode === 'delete')
              await f.database.execute(
                "DELETE FROM conversation_artifacts WHERE id='older'",
              );
            if (mode === 'cancel') controller.abort();
            if (mode === 'failure')
              throw new Error('Synthetic storage failure');
          }
          return validate(...args);
        });
      await expect(
        restoreConversationSessionTurns(
          f.input,
          f.open,
          'session',
          controller.signal,
        ),
      ).rejects.toThrow();
      expect(calls).toBe(2);
    } finally {
      jest.restoreAllMocks();
      f.close();
    }
  },
);

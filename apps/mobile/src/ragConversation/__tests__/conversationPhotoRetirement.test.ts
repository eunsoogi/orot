import { createConversationPhotoRetirement } from '../conversationPhotoRetirement';

test('a failed database fence keeps cleanup pending and never deletes the original', async () => {
  const fence = jest
    .fn()
    .mockRejectedValueOnce(new Error('database unavailable'))
    .mockResolvedValue(undefined);
  const discard = jest.fn().mockResolvedValue(undefined);
  const retirement = createConversationPhotoRetirement({ fence, discard });
  await expect(retirement.retire('source')).rejects.toThrow();
  expect(retirement.pending()).toEqual(['source']);
  expect(discard).not.toHaveBeenCalled();
  await retirement.retire('source');
  expect(discard).toHaveBeenCalledWith('source');
  expect(retirement.pending()).toEqual([]);
});

test('failed native cleanup remains retryable without removing the source fence', async () => {
  const fence = jest.fn().mockResolvedValue(undefined);
  const discard = jest
    .fn()
    .mockRejectedValueOnce(new Error('unavailable'))
    .mockResolvedValue(undefined);
  const retirement = createConversationPhotoRetirement({ fence, discard });
  await expect(retirement.retire('source')).rejects.toThrow();
  expect(retirement.pending()).toEqual(['source']);
  await retirement.retire('source');
  expect(fence).toHaveBeenCalledTimes(2);
  expect(retirement.pending()).toEqual([]);
});

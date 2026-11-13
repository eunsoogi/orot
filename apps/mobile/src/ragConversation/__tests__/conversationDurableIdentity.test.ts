import { createConversationDurableIdentity } from '../conversationDurableIdentity';

test('durable IDs come from independent secure random bytes, not the clock', () => {
  let sequence = 0;
  const random = jest
    .spyOn(globalThis.crypto, 'getRandomValues')
    .mockImplementation(target => {
      (target as Uint8Array).fill(++sequence);
      return target;
    });
  const now = jest.spyOn(Date, 'now').mockReturnValue(1);
  try {
    expect(createConversationDurableIdentity()).toBe(
      `conversation:${'01'.repeat(16)}`,
    );
    expect(createConversationDurableIdentity()).toBe(
      `conversation:${'02'.repeat(16)}`,
    );
    expect(now).not.toHaveBeenCalled();
  } finally {
    now.mockRestore();
    random.mockRestore();
  }
});

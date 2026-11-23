import { projectTranscript } from '../conversationBubblePaint';
import { createConversationSessionRestoreState } from '../conversationSessionRestoreState';

test.each([
  { completion: 'partial' as const },
  {
    interrupted: true as const,
    interruptionReason: 'process-interrupted' as const,
  },
])(
  'restores an uncertain request without ongoing activity: %j',
  async state => {
    const update = jest.fn();
    const read = jest.fn(async () => [
      {
        question: 'Synthetic question',
        answer: '',
        citations: [],
        toolMessageId: 'request',
        ...state,
      },
    ]);
    const readSteering = jest.fn();
    const restoration = createConversationSessionRestoreState({
      update,
      read,
      readSteering,
    });
    await restoration.start(1, 'session');
    expect(read).toHaveBeenCalledTimes(1);
    expect(readSteering).not.toHaveBeenCalled();
    expect(update).toHaveBeenLastCalledWith(
      1,
      expect.objectContaining({
        restoring: false,
        messages: [
          expect.objectContaining({
            role: 'user',
            content: 'Synthetic question',
          }),
          expect.objectContaining({
            role: 'assistant',
            incomplete: true,
            interruptionReason: 'process-interrupted',
            coldResume: undefined,
            activity: undefined,
          }),
        ],
      }),
    );
    const messages = update.mock.lastCall?.[1].messages;
    expect(
      projectTranscript(messages, false).map(message => message.role),
    ).toEqual(['user']);
  },
);

import { fireEvent, screen, waitFor } from '@testing-library/react-native';
import * as nativeExecution from '../../ragConversation/conversationExecutionNative';
import type { createConversationArtifactStorage } from '../conversationArtifactStorage';
import type { ConversationArtifact } from '../conversationArtifactTypes';

type Storage = ReturnType<typeof createConversationArtifactStorage>;
type Native = NonNullable<
  ReturnType<typeof nativeExecution.conversationExecutionNative>
>;
type Event = Parameters<Parameters<Native['subscribe']>[0]>[0];

export async function exerciseColdDailyReportBookmarkTap(
  conversations: Storage,
  historical: ConversationArtifact,
  bookmark: jest.SpyInstance<
    ReturnType<Storage['bookmarkDailyReport']>,
    Parameters<Storage['bookmarkDailyReport']>
  >,
) {
  const nativeListeners = new Set<(event: Event) => void>();
  const protection = jest.fn().mockResolvedValue(true);
  protection.mockResolvedValueOnce(true).mockImplementationOnce(async () => {
    // The second native check occurs after the existing exact SQL pin insert.
    for (const available of [false, true])
      for (const listener of [...nativeListeners])
        listener({ kind: 'protectedData', available });
    return true; // A positive probe must not revive a retired lease.
  });
  const native = jest
    .spyOn(nativeExecution, 'conversationExecutionNative')
    .mockReturnValue({
      bridgeAvailable: true,
      currentPhase: () => 'active',
      protectedDataAvailable: protection,
      subscribe(listener: (event: Event) => void) {
        nativeListeners.add(listener);
        return () => {
          nativeListeners.delete(listener);
        };
      },
    } as unknown as Native);
  try {
    const button = () =>
      screen.getByTestId('conversation-bookmark-daily-report');
    await fireEvent.press(
      await screen.findByTestId('conversation-bookmark-daily-report'),
    );
    await waitFor(() => expect(protection).toHaveBeenCalledTimes(2));
    await expect(bookmark.mock.results[0]?.value).rejects.toThrow(
      'Report bookmark owner moved.',
    );
    expect(await conversations.listSavedGeneratedReportReferences()).toEqual(
      [],
    );
    expect(screen.queryByText('보고서 링크를 기억에 보관했어요.')).toBeNull();
    await waitFor(() => expect(button()).not.toBeDisabled());

    bookmark.mockClear();
    await fireEvent.press(button());
    await waitFor(() => expect(bookmark).toHaveBeenCalledTimes(1));
    expect(bookmark).toHaveBeenCalledWith(
      expect.objectContaining({
        artifactId: historical.id,
        displayedReport: {
          runId: historical.dailyReport!.runId,
          revision: historical.dailyReport!.revision,
          identityKey: historical.dailyReport!.identity.key,
        },
        confirmArchivedProtection: expect.any(Function),
      }),
    );
    await expect(bookmark.mock.results[0]?.value).resolves.toBe(true);
  } finally {
    native.mockRestore();
  }
}

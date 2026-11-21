import { fireEvent, render } from '@testing-library/react-native';
import { Linking } from 'react-native';
import type { AiFeatureLocalData } from '../../aiFeatures/integration/localData';
import { createArchivedCitationService } from '../../aiFeatures/integration/archivedCitationService';
import { conversationSavedHistoryDisplayOption } from '../../aiFeatures/integration/conversationSavedHistoryDisplayOption';
import { setup } from '../../storage/testSupport/conversationHistoryDisplayFixture';
import { ConversationMessage } from '../ConversationMessage';
import { savedHistoryTranscript } from '../conversationSavedHistoryDisplay';
import { ResolveArchivedCitationContext } from '../useArchivedCitationOpen';

test('an original saved public citation opens its correct original URL only when pressed', async () => {
  const f = await setup();
  const openUrl = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
  const selectedReads = jest.spyOn(f.storage, 'readSelectedArchivedCitation');
  const onOpenSource = jest.fn();
  const onLinkError = jest.fn();
  const local = jest.fn(
    async () =>
      ({
        openConversationArtifactStorage: async () => f.storage,
      }) as AiFeatureLocalData,
  );
  const archive = createArchivedCitationService(local);
  try {
    const reference = {
      ...f.external.reference,
      sourceId: 'public-web',
      locator: {
        kind: 'public_web_search',
        sources: [
          { title: 'First saved link', url: 'https://example.org/first' },
          { title: 'Second saved link', url: 'https://example.org/second' },
        ],
      },
    };
    const saved = await f.save('public-two-links', {
      answer: 'Old public answer',
      sources: [{ ...f.external, reference }],
      citations: [reference],
    });
    const read = conversationSavedHistoryDisplayOption(async () => ({
      ...f.storage,
      readSessionPresentationMany: (_sessionId, version, ids) =>
        f.display(ids, version),
    }));
    const page = await read(saved.sessionId, 0, new AbortController().signal);
    const message = savedHistoryTranscript(
      [{ row: page.rows[0]!, questionId: -1, answerId: -2 }],
      [],
    )[1]!;
    const ui = await render(
      <ResolveArchivedCitationContext.Provider value={archive.resolve}>
        <ConversationMessage
          message={message}
          onOpenSource={onOpenSource}
          onLinkError={onLinkError}
        />
      </ResolveArchivedCitationContext.Provider>,
    );
    try {
      expect(ui.getByText('Old public answer')).toBeTruthy();
      expect(ui.getByText('First saved link')).toBeTruthy();
      expect(ui.getByText('Second saved link')).toBeTruthy();
      expect(selectedReads).not.toHaveBeenCalled();
      expect(openUrl).not.toHaveBeenCalled();
      expect(local).not.toHaveBeenCalled();
      await fireEvent.press(
        ui.getByRole('link', { name: 'Second saved link' }),
      );
      expect(openUrl).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledWith('https://example.org/second');
      expect(selectedReads).toHaveBeenCalledTimes(1);
      expect(onOpenSource).not.toHaveBeenCalled();
      await f.storage.hideSession(saved.sessionId, 0);
      await fireEvent.press(ui.getByRole('link', { name: 'First saved link' }));
      expect(onLinkError).toHaveBeenCalledTimes(1);
      expect(openUrl).toHaveBeenCalledTimes(1);
    } finally {
      await ui.unmount();
    }
  } finally {
    openUrl.mockRestore();
    f.close();
  }
});

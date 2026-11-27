import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { AppState, Text } from 'react-native';
import { syntheticDirectJPEG } from '../../aiFeatures/integration/testSupport/directPhotoSendFixture';
import { conversationDirectPhotoPorts as ports } from '../conversationDirectPhotoPorts';
import { conversationExecutionNative } from '../conversationExecutionNative';
import { currentConversationMessages } from '../currentConversationMessages';
import { directPhotoComposerFixture } from '../testSupport/directPhotoComposerFixture';

import { ConversationQuickChoices } from '../ConversationQuickChoices';
import { createConversationSessions } from '../conversationSessions';
import { Transcript } from '../testSupport/savedHistoryDisplayFixture';

const priorAnswer = '이전 대화에 저장된 답변';
const highlight = '파란색 물체와 흰 상자';
const photoAnswer = '사진에는 **' + highlight + '**가 있어요.';
const date = '2026-10-05T00:00:00.000Z';
const divider = 'conversation-choices-divider';
const choices = (
  <ConversationQuickChoices>
    <Text>대화 선택지</Text>
  </ConversationQuickChoices>
);

function expectOrder(painted: string, ...rows: string[]) {
  let previous = -1;
  for (const row of rows) {
    const offset = painted.indexOf(row);
    expect(offset).toBeGreaterThan(previous);
    previous = offset;
  }
}

jest.mock('../conversationDirectPhotoPorts', () => ({
  conversationDirectPhotoPorts: {
    hasPicker: jest.fn(() => true),
    pick: jest.fn(),
    authorization: jest.fn(),
    grant: jest.fn(),
  },
}));
jest.mock('../conversationExecutionNative', () => ({
  conversationExecutionNative: jest.fn(),
}));

test.each([1, 2])(
  'keeps a %i-photo turn in the same current conversation bubble after completion',
  async count => {
    const phase = AppState.currentState;
    AppState.currentState = 'active';
    jest.mocked(conversationExecutionNative).mockReturnValue({
      bridgeAvailable: true,
      protectedDataAvailable: async () => true,
      subscribe: () => () => {},
      begin: async () => true,
      end: () => {},
      isActive: async () => true,
    });
    const fixture = await directPhotoComposerFixture({
      hold: true,
      entryChoices: choices,
      photoAnswer,
      async seed(storage) {
        const row = {
          id: 'earlier',
          sessionId: 'selected',
          question: '이전 질문',
          createdAt: date,
        };
        await storage.startRequest({ ...row, sessionVersion: 0 });
        await storage.append({
          ...row,
          answer: priorAnswer,
          status: 'complete',
          providerId: 'synthetic',
          modelId: 'synthetic',
          sources: [],
          citations: [],
        });
      },
    });
    const caption = '첨부 사진을 비교해 줘.';
    const authorize = jest.mocked(ports.grant).getMockImplementation()!;
    jest.mocked(ports.grant).mockImplementation(async (...args) => {
      const grant = await authorize(...args);
      return grant ? { ...grant, retainAuthoredCaption: true } : grant;
    });
    const preview =
      count === 1 ? syntheticDirectJPEG : [syntheticDirectJPEG, '/9j/C//Z'];
    jest.mocked(ports.pick).mockResolvedValue(preview);
    let ui = await render(fixture.view);
    try {
      await fireEvent.press(screen.getByRole('button', { name: '사진 첨부' }));
      await fireEvent.changeText(
        screen.getByTestId('rag-conversation-input'),
        caption,
      );
      await fireEvent.press(screen.getByTestId('rag-conversation-send'));
      expect(screen.getAllByText(caption)).toHaveLength(1);
      expect(screen.getAllByText(/전송 중/u)).toHaveLength(1);
      expectOrder(JSON.stringify(ui.toJSON()), priorAnswer, divider, caption);
      const before = currentConversationMessages(fixture.session()).find(
        message => message.content === caption,
      );
      await act(() => fixture.completePhoto());
      expect(await screen.findByText(highlight)).toHaveStyle({
        fontWeight: '700',
      });
      expect(screen.getAllByText(caption)).toHaveLength(1);
      expect(screen.queryByText(/전송 중/u)).toBeNull();
      expect(
        screen.getAllByTestId('conversation-sent-photo-image'),
      ).toHaveLength(count);
      expect(before).toMatchObject({ role: 'user', deliveryPending: true });
      const current = currentConversationMessages(fixture.session());
      expect(current.map(message => message.content)).toEqual([
        caption,
        photoAnswer,
      ]);
      expect(current[0]?.id).toBe(before?.id);
      expect(
        current.every(message => message.id > 0 && !message.restoredHistory),
      ).toBe(true);
      expect(
        fixture.session().savedHistoryDisplay?.map(item => item.row.id),
      ).toEqual(['earlier']);
      expectOrder(
        JSON.stringify(ui.toJSON()),
        priorAnswer,
        divider,
        caption,
        highlight,
      );
      expect(fixture.session().messages).toEqual([]);
      await ui.unmount();
      ui = await render(fixture.renderView());
      expect(screen.getAllByText(caption)).toHaveLength(1);
      expect(screen.getAllByText(highlight)).toHaveLength(1);
      await ui.unmount();
      const reopened = createConversationSessions(fixture.createOptions());
      try {
        await reopened.attachExisting('selected', 0, date);
        ui = await render(
          <Transcript store={reopened} entryChoices={choices} />,
        );
        expect(await screen.findAllByText(highlight)).toHaveLength(1);
        expect(screen.getByText(highlight)).toHaveStyle({ fontWeight: '700' });
        expect(screen.getAllByText(caption)).toHaveLength(1);
        expect(
          screen.queryByTestId('conversation-sent-photo-image'),
        ).toBeNull();
        expect(reopened.getSnapshot().sessions[0]?.messages).toEqual([]);
        expectOrder(
          JSON.stringify(ui.toJSON()),
          priorAnswer,
          caption,
          highlight,
          divider,
        );
      } finally {
        await ui.unmount();
        reopened.dispose();
      }
    } finally {
      await ui.unmount();
      fixture.close();
      AppState.currentState = phase;
    }
  },
);

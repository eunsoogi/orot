import { render, screen } from '@testing-library/react-native';
import { StyleSheet, View } from 'react-native';
import type { ComponentProps } from 'react';
import { AppText } from '../../layout/AppText';
import {
  ConversationBubbleEntrance,
  ConversationBubbleEntranceContext,
} from '../ConversationBubbleEntrance';
import type { ConversationBubbleCopy } from '../ConversationBubbleCopyHost';
import { createConversationBubbleEntrances } from '../conversationBubbleEntrances';
import { styles } from '../ConversationScreen.styles';
import { trackEntrances } from '../testSupport/bubbleEntranceMotion';

const mockMount = jest.fn();
const mockUnmount = jest.fn();
jest.mock('../ConversationBubbleCopyHost', () => {
  const { View: Host } = require('react-native');
  const { useEffect: effect } = require('react');
  function NativeCopy(
    props: ComponentProps<typeof View> & ConversationBubbleCopy,
  ) {
    effect(() => {
      mockMount();
      return mockUnmount;
    }, []);
    return <Host {...props} />;
  }
  return {
    ConversationBubbleCopyHost: NativeCopy,
    AnimatedConversationBubbleCopyHost: NativeCopy,
  };
});

test('ordinary Copy keeps one surface and exact text across live and restored presentation', async () => {
  const { start } = trackEntrances();
  const receipts = createConversationBubbleEntrances();
  const raw = '합성 질문: 줄바꿈\n**사용자 일반 텍스트**';
  const bubble = (restored: boolean) => (
    <ConversationBubbleEntranceContext.Provider
      value={{ receipts, motionAllowed: !restored }}
    >
      <AppText testID="adjacent-report">합성 진료 질문</AppText>
      <ConversationBubbleEntrance
        entranceKey="synthetic-outgoing"
        restored={restored}
        isolateUserCopyPaint
        copyMenu={{
          copyOwner: 'synthetic-owner',
          copyText: raw,
          copyLabel: '복사',
        }}
        testID="conversation-user-message"
        style={styles.userMessage}
      >
        <AppText selectable={false}>{raw}</AppText>
      </ConversationBubbleEntrance>
      <AppText testID="delivery-receipt">읽음</AppText>
    </ConversationBubbleEntranceContext.Provider>
  );
  try {
    const ui = await render(bubble(false));
    const host = () => screen.getByTestId('conversation-user-message');
    expect(StyleSheet.flatten(host().props.style)).toEqual(
      StyleSheet.flatten(styles.userMessageSurface),
    );
    expect(host().props.copyText).toBe(raw);
    expect(screen.getAllByText(raw)).toHaveLength(1);
    expect(start).toHaveBeenCalledTimes(1);
    await ui.rerender(bubble(true));
    expect(mockMount).toHaveBeenCalledTimes(1);
    expect(mockUnmount).not.toHaveBeenCalled();
    expect(host().props.copyOwner).toBe('synthetic-owner');
    expect(screen.getAllByText(raw)).toHaveLength(1);
    expect(screen.getByTestId('adjacent-report')).toBeTruthy();
    expect(screen.getByTestId('delivery-receipt')).toBeTruthy();
    expect(start).toHaveBeenCalledTimes(1);
    await ui.unmount();
  } finally {
    jest.restoreAllMocks();
  }
});

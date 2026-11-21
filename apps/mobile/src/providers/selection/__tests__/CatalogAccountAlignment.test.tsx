import {
  fireEvent,
  render,
  screen,
  within,
} from '@testing-library/react-native';
import { StyleSheet, View, type ViewStyle } from 'react-native';
import { VoiceCatalogAccount } from '../../../voiceSettings/VoiceCatalogAccount';
import { ApiCatalogAccount } from '../ApiCatalogAccount';
import { ProviderCatalogAccount } from '../ProviderCatalogAccount';
import type { ChatGPTAccountSetup } from '../types';

type MountedView = ReturnType<typeof screen.getByTestId>;

const account: ChatGPTAccountSetup = {
  presentation: 'settings-provider',
  accounts: [
    {
      issuedClientID: 'synthetic',
      requiresSignIn: false,
      hasDirectPlanAccess: true,
    },
  ],
  selectedAccountID: 'synthetic',
  statusMessage: '',
  statusIsError: false,
  actionTitle: '모델 새로고침',
  busy: false,
  signingIn: false,
  signingOut: false,
  actionDisabled: false,
  onAccountSelected() {},
  onAction() {},
  onSignOut() {},
  onCancelSignIn() {},
};

function ancestorStyles(node: MountedView): ViewStyle[] {
  const styles: ViewStyle[] = [];
  for (let parent = node.parent; parent; parent = parent.parent) {
    const style = StyleSheet.flatten<ViewStyle>(parent.props.style);
    if (style) styles.push(style);
  }
  return styles;
}

function actionGeometry(node: MountedView, cardWidth: number) {
  const styles = ancestorStyles(node);
  const content = styles.find(style => typeof style.padding === 'number');
  const lane = styles.find(style => style.width === 44);
  const header = styles.find(style => style.flexDirection === 'row');
  // Host Jest does not run native layout. Compute the fixed trailing inset from
  // the mounted style contract at each input width, not from a mock onLayout.
  expect(content?.padding).toBe(16);
  expect(lane).toMatchObject({
    width: 44,
    marginRight: -13,
    justifyContent: 'center',
  });
  expect(header).toMatchObject({ flexDirection: 'row', alignItems: 'center' });
  expect(StyleSheet.flatten(node.props.style)).toMatchObject({
    width: 44,
    height: 44,
  });
  expect(node.props.accessibilityRole).toBe('button');
  const right =
    cardWidth - Number(content?.padding) - Number(lane?.marginRight);
  const left = right - Number(lane?.width);
  expect(left).toBeGreaterThan(0);
  expect(right).toBeLessThanOrEqual(cardWidth);
  return { left, right, center: (right + left) / 2 };
}

test.each([230, 532])(
  'model settings reuse one 44pt account action lane at width %ipt',
  async width => {
    const chat = jest.fn();
    const calendar = jest.fn();
    const voice = jest.fn(async () => {});
    await render(
      <View style={{ width }}>
        <View testID="conversation-chatgpt-card">
          <ProviderCatalogAccount setup={{ ...account, onAction: chat }} />
        </View>
        <View testID="calendar-chatgpt-card">
          <ProviderCatalogAccount setup={{ ...account, onAction: calendar }} />
        </View>
        <ApiCatalogAccount
          busy={false}
          connected
          refresh={calendar}
          refreshLabel="모델 새로고침"
          testIDPrefix="calendar"
        />
        <VoiceCatalogAccount
          catalog={{
            connected: true,
            busy: false,
            ids: [],
            fresh: true,
            message: '',
            revision: 1,
            refresh: voice,
          }}
        />
      </View>,
    );
    const conversation = within(
      screen.getByTestId('conversation-chatgpt-card'),
    );
    const calendarChat = within(screen.getByTestId('calendar-chatgpt-card'));
    const pairs = [
      [
        conversation.getByTestId('settings-provider-load-models'),
        conversation.getByTestId('chatgpt-account-details'),
      ],
      [
        calendarChat.getByTestId('settings-provider-load-models'),
        calendarChat.getByTestId('chatgpt-account-details'),
      ],
      [
        screen.getByTestId('calendar-model-refresh'),
        screen.getByTestId('calendar-account-details'),
      ],
      [
        screen.getByTestId('voice-model-refresh'),
        screen.getByTestId('voice-account-details'),
      ],
    ] as const;

    for (const [action, details] of pairs) {
      expect(StyleSheet.flatten(details.props.style)).toMatchObject({
        flex: 1,
        minWidth: 0,
      });
      const before = actionGeometry(action, width);
      expect(before.center).toBe(width - 25);
      await fireEvent.press(details);
      expect(details.props.accessibilityState.expanded).toBe(true);
      expect(actionGeometry(action, width)).toEqual(before);
      await fireEvent.press(action);
    }
    expect(chat).toHaveBeenCalledTimes(1);
    expect(calendar).toHaveBeenCalledTimes(2);
    expect(voice).toHaveBeenCalledTimes(1);
  },
);

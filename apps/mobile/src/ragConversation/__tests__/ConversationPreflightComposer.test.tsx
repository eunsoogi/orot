import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { ConversationSteeringComposer } from '../ConversationSteeringComposer';
import { createEmptyConversation } from '../conversationEmptySession';
import { createConversationSessions } from '../conversationSessions';

/** Preflight retains the draft, so Stop must not accidentally become a steering action. */
test('preparation keeps an enabled Stop without a status banner', async () => {
  const cancel = jest.fn();
  const steer = jest.fn();
  const store = createConversationSessions();
  const mounted = await render(
    <ConversationSteeringComposer
      session={{
        ...createEmptyConversation(1),
        draft: 'Synthetic draft',
        preparingSend: true,
        modelSelectionPending: true,
      }}
      store={{ ...store, steer }}
      disabled
      onChangeText={jest.fn()}
      onSend={jest.fn()}
      onCancel={cancel}
    />,
  );
  expect(screen.queryByTestId('conversation-preflight-status')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    'Synthetic draft',
  );
  await fireEvent.press(screen.getByTestId('rag-conversation-cancel'));
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(steer).not.toHaveBeenCalled();
  await mounted.unmount();
  store.dispose();
});

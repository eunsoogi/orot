import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { AlertButton } from 'react-native';
import { navigationText } from '../../../i18n/navigation';
import { AiFeatureRoute } from '../AiFeatureRoute';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);

afterEach(() => jest.restoreAllMocks());

test('keeps a RAG draft when shared back confirmation is canceled', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  const view = await render(<AiFeatureRoute onBack={jest.fn()} />);

  await fireEvent.press(view.getByTestId('ai-feature-rag-conversation'));
  const input = view.getByTestId('rag-conversation-input');
  await fireEvent.changeText(
    input,
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  await fireEvent.press(view.getByTestId('navigation-back'));

  await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
  expect(alert.mock.calls[0]?.[0]).toBe(navigationText.leaveUnsaved.title);
  await pressAlertButton(alert, 0);

  expect(view.getByTestId('rag-conversation-input').props.value).toBe(
    '다음 진료에서 확인할 내용을 정리하고 싶어요.',
  );
  expect(view.getByTestId('rag-conversation-screen')).toBeTruthy();
});

/** Resumes the route guard through the same native Alert callback used by the app. */
async function pressAlertButton(alert: jest.SpyInstance, index: number) {
  const buttons = alert.mock.calls.at(-1)?.[2] as AlertButton[] | undefined;
  const press = buttons?.[index]?.onPress;
  if (!press) throw new Error(`Alert button ${index} was not registered.`);
  await act(async () => {
    press();
    await Promise.resolve();
  });
}

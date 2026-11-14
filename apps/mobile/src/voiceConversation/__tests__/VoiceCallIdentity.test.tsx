import { render, screen } from '@testing-library/react-native';
import { VoiceCallIdentity } from '../VoiceCallIdentity';

jest.mock('../../assistantAppearance/AssistantAppearanceProvider', () => ({
  useAssistantAppearance: () => ({
    ready: true,
    value: { avatar: 'leaf', name: '저장한 이름' },
  }),
}));

test('shows saved identity without an editable settings action or mockup name', async () => {
  await render(<VoiceCallIdentity />);
  expect(screen.getByRole('header', { name: '저장한 이름' })).toBeTruthy();
  expect(screen.queryByText('Momo')).toBeNull();
  expect(screen.queryByRole('button')).toBeNull();
});

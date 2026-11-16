import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppState } from 'react-native';
import { SavedMemoryBrowser } from '../SavedMemoryBrowser';
import { AppButton } from '../../layout/AppButton';

beforeEach(() => {
  AppState.currentState = 'active';
  jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() });
});

/** Synthetic long text: native wrapping is bounded, not the accessible name or stored data. */
test('caps the preview at two lines and preserves full text and detail navigation', async () => {
  const text = '합성 기억의 전체 문장을 유지합니다. '.repeat(20);
  const label = text.trim();
  const open = jest.fn();
  const row = {
    id: 'synthetic-long',
    text,
    kind: 'preference' as const,
    createdAt: 1000,
    provenance: { sourceIds: [], reviewState: 'user_confirmed' as const },
  };
  await render(
    <SavedMemoryBrowser load={async () => [row]} onOpenMemory={open} />,
  );
  const preview = screen.getByText(label);
  expect(preview.props.numberOfLines).toBe(2);
  expect(preview.props.ellipsizeMode).toBe('tail');
  expect(preview.props.allowFontScaling).toBe(true);
  expect(preview.props.adjustsFontSizeToFit).not.toBe(true);
  expect(preview).toHaveStyle({ fontSize: 16, lineHeight: 22 });
  const button = screen.getByRole('button', { name: new RegExp(label) });
  expect(button.props.testID).toBe(`saved-memory-entry-${row.id}`);
  expect(button.props.accessibilityLabel).toContain(label);
  expect(button).toHaveStyle({ minHeight: 44, paddingVertical: 8 });
  expect(screen.getByTestId('saved-memory-browser')).toHaveStyle({ gap: 4 });
  await fireEvent.press(button);
  expect(open).toHaveBeenCalledWith(row.id);
  expect(row.text).toBe(text);
});

test('does not impose a line cap on other shared buttons', async () => {
  await render(
    <AppButton
      variant="list"
      title="Unbounded title"
      summary="Supporting detail"
    />,
  );
  expect(
    screen.getByText('Unbounded title').props.numberOfLines,
  ).toBeUndefined();
  expect(screen.getByText('Unbounded title').props.allowFontScaling).toBe(true);
});

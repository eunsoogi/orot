// These route/consent fixtures omit native protected storage; continuity is exercised with real SQLite separately.
jest.mock('../continuousSessionOption', () => ({
  continuousSessionOption: () => ({}),
}));
import { fireEvent, render, screen } from '@testing-library/react-native';
import { AiFeatureRoute } from '../AiFeatureRoute';
import { t } from '../../../i18n';

jest.mock(
  'react-native-safe-area-context',
  () => require('react-native-safe-area-context/jest/mock').default,
);
jest.mock('../../../providers/selection/options', () => {
  const actual = jest.requireActual('../../../providers/selection/options');
  return {
    ...actual,
    loadAppleSelectionOption: jest.fn(async () =>
      actual.createAppleSelectionOption('available'),
    ),
  };
});

// These synthetic component routes exercise real intent wiring without inference or health data.
test('default records conversation exposes exactly the four retained workflows', async () => {
  await render(<AiFeatureRoute onBack={jest.fn()} />);
  for (const id of [
    'conversation-open-possibilities',
    'conversation-open-visit-questions',
    'conversation-open-health-summary',
    'daily-report-request',
  ]) {
    expect(screen.getAllByTestId(id)).toHaveLength(1);
    expect(screen.getByTestId(id)).not.toBeDisabled();
  }
  expect(screen.queryByText(t('treatmentSafety.open'))).toBeNull();
});

test.each([
  ['possibilities', 'conversationIntent.possibilities'],
  ['health-summary', 'conversationIntent.healthSummary'],
] as const)(
  'selects %s in place only after preserving and clearing the pending draft',
  async (action, key) => {
    await render(<AiFeatureRoute onBack={jest.fn()} />);
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      'synthetic draft',
    );
    // A pending draft keeps its original purpose; selecting a choice cannot replace it.
    expect(screen.getByTestId(`conversation-open-${action}`)).toBeDisabled();
    await fireEvent.press(screen.getByTestId(`conversation-open-${action}`));
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      'synthetic draft',
    );
    expect(
      screen.queryByTestId('conversation-intent-use-suggestion'),
    ).toBeNull();
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      '',
    );
    await fireEvent.press(screen.getByTestId(`conversation-open-${action}`));
    expect(
      screen.queryByTestId('conversation-intent-use-suggestion'),
    ).toBeNull();
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      '',
    );
    expect(screen.queryByTestId('rag-conversation-progress')).toBeNull();
    for (const id of [
      'conversation-open-possibilities',
      'conversation-open-visit-questions',
      'conversation-open-health-summary',
      'daily-report-request',
    ]) {
      expect(screen.getAllByTestId(id)).toHaveLength(1);
    }
    // The composer remains available for a user-authored request, without a prompt-copy button.
    await fireEvent.changeText(
      screen.getByTestId('rag-conversation-input'),
      t(key),
    );
    expect(screen.getByTestId('rag-conversation-input')).toHaveProp(
      'value',
      t(key),
    );
  },
);

test('opens explicit visit preparation even without the legacy saved-question renderer', async () => {
  await render(<AiFeatureRoute onBack={jest.fn()} />);
  await fireEvent.press(
    screen.getByTestId('conversation-open-visit-questions'),
  );
  expect(screen.getByTestId('conversation-visit-prepare')).toBeTruthy();
  expect(screen.queryByTestId('conversation-intent-use-suggestion')).toBeNull();
  expect(screen.getByTestId('rag-conversation-input')).toHaveProp('value', '');
  expect(screen.queryByTestId('rag-conversation-progress')).toBeNull();
});

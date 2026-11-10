import { fireEvent, render, screen } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { ConversationScreen } from '../ConversationScreen';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const openDatabase = jest.mocked(openLocalAgentMemoryDatabase);

async function openTreatment() {
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.open') }),
  );
}

async function enterReading(systolic: string, diastolic: string) {
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.adult') }),
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.systolic')),
    systolic,
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.diastolic')),
    diastolic,
  );
}

test('explicit local safety flow preserves the draft and prioritizes policy without opening storage', async () => {
  const onSend = jest.fn();
  await render(
    <ConversationScreen
      onSend={onSend}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  const draft = screen.getByTestId('rag-conversation-input');
  await fireEvent.changeText(draft, '기존 초안');
  expect(screen.queryByText(t('treatmentSafety.confirmation'))).toBeNull();
  await openTreatment();
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.skip') }),
  );
  await screen.findByText(t('treatmentSafety.inputRequired'));
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.close') }),
  );

  await openTreatment();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '',
  );
  await enterReading('190', '120');
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.chestPain') }),
  );
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.skip') }),
  );
  await screen.findByText(t('treatmentSafety.emergency'));
  expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
  expect(openDatabase).not.toHaveBeenCalled();
  expect(onSend).not.toHaveBeenCalled();
  await fireEvent.press(
    screen.getByRole('button', { name: t('treatmentSafety.close') }),
  );
  expect(screen.getByTestId('rag-conversation-input').props.value).toBe(
    '기존 초안',
  );
});

test('complete current input reaches the verified local producer without entering conversation history', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    openDatabase.mockResolvedValueOnce(connection.database);
    const onSend = jest.fn();
    await render(
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />,
    );
    await openTreatment();
    await enterReading('120', '80');
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.none') }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
    );
    await screen.findByText(t('treatmentSafety.generalOptions'));
    expect(screen.queryByLabelText(t('treatmentSafety.systolic'))).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.close') }),
    );
    expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
  } finally {
    connection.close();
  }
});

// Exercise the retired UI only in this harness to preserve its safety and data tests.
jest.mock('../ConversationTaskPanels', () =>
  require('../testFixtures/LegacyTreatmentTaskPanels'),
);
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { runMigrations } from '@orot/storage';
import { openSqliteTestDatabase } from '../../../../../packages/storage/__tests__/sqliteTestDatabase';
import { t } from '../../i18n';
import { notifyLocalSourceDeleted } from '../../storage/localDataClearEvents';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { ConversationScreen } from '../ConversationScreen';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

test('a source deletion notification removes a visible treatment explanation', async () => {
  const connection = openSqliteTestDatabase(':memory:');
  try {
    await runMigrations(connection.database);
    jest
      .mocked(openLocalAgentMemoryDatabase)
      .mockResolvedValue(connection.database);
    const onSend = jest.fn();
    await render(
      <ConversationScreen
        onSend={onSend}
        onBack={jest.fn()}
        onOpenSource={jest.fn()}
      />,
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.open') }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.adult') }),
    );
    await fireEvent.changeText(
      screen.getByLabelText(t('treatmentSafety.systolic')),
      '120',
    );
    await fireEvent.changeText(
      screen.getByLabelText(t('treatmentSafety.diastolic')),
      '80',
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.none') }),
    );
    await fireEvent.press(
      screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
    );
    expect(
      await screen.findByText(t('treatmentSafety.generalOptions')),
    ).toBeTruthy();
    await act(async () => notifyLocalSourceDeleted('local'));
    expect(screen.queryByText(t('treatmentSafety.generalOptions'))).toBeNull();
    expect(screen.queryByTestId('inline-treatment-task')).toBeNull();
    expect(onSend).not.toHaveBeenCalled();
  } finally {
    connection.close();
    jest.mocked(openLocalAgentMemoryDatabase).mockReset();
  }
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { t } from '../../i18n';
import { openLocalAgentMemoryDatabase } from '../../storage/secureDatabase';
import { ConversationScreen } from '../ConversationScreen';

jest.mock('../../storage/secureDatabase', () => ({
  openLocalAgentMemoryDatabase: jest.fn(),
}));

const openDatabase = jest.mocked(openLocalAgentMemoryDatabase);
beforeEach(() => openDatabase.mockReset());

async function press(
  name:
    | 'treatmentSafety.open'
    | 'treatmentSafety.adult'
    | 'treatmentSafety.none'
    | 'treatmentSafety.confirm'
    | 'treatmentSafety.close',
) {
  await fireEvent.press(screen.getByRole('button', { name: t(name) }));
}

async function openTreatment() {
  await press('treatmentSafety.open');
}

async function openAndSubmit() {
  await render(
    <ConversationScreen
      onSend={jest.fn()}
      onBack={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  await openTreatment();
  await press('treatmentSafety.adult');
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.systolic')),
    '120',
  );
  await fireEvent.changeText(
    screen.getByLabelText(t('treatmentSafety.diastolic')),
    '80',
  );
  await press('treatmentSafety.none');
  await press('treatmentSafety.confirm');
}

function holdStorageRead() {
  let rejectOpen!: (error: Error) => void;
  openDatabase.mockImplementationOnce(
    () =>
      new Promise((_, reject) => {
        rejectOpen = reject;
      }),
  );
  return () =>
    act(async () => rejectOpen(new Error('Synthetic storage failure')));
}

test('a failed submit keeps the local form for retry until the sheet closes', async () => {
  const rejectOpen = holdStorageRead();
  await openAndSubmit();
  expect(screen.getByText(t('treatmentSafety.checking'))).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
  ).toBeDisabled();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '120',
  );
  await rejectOpen();
  expect(screen.getByRole('alert')).toBeTruthy();
  expect(
    screen.getByRole('button', { name: t('treatmentSafety.confirm') }),
  ).toBeEnabled();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '120',
  );
  const rejectRetry = holdStorageRead();
  await press('treatmentSafety.confirm');
  expect(openDatabase).toHaveBeenCalledTimes(2);
  await rejectRetry();
  await press('treatmentSafety.close');
  await openTreatment();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '',
  );
});

test('closing a pending submit clears the local input and ignores its late rejection', async () => {
  const rejectOpen = holdStorageRead();
  await openAndSubmit();
  await press('treatmentSafety.close');
  await openTreatment();
  await rejectOpen();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByText(t('treatmentSafety.checking'))).toBeNull();
  expect(screen.getByLabelText(t('treatmentSafety.systolic')).props.value).toBe(
    '',
  );
  expect(
    screen.getByRole('button', { name: t('treatmentSafety.adult') }),
  ).toHaveProp(
    'accessibilityState',
    expect.objectContaining({ selected: false }),
  );
});

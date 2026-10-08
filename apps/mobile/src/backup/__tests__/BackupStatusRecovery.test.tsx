import { render, screen } from '@testing-library/react-native';
import { prepareBackupSupport } from '../backupSupport';
import BackupStatusRecovery from '../BackupStatusRecovery';

jest.mock('../backupSupport', () => ({
  prepareBackupSupport: jest.fn(),
}));

test('labels local eligibility without presenting it as iCloud backup completion', async () => {
  jest.mocked(prepareBackupSupport).mockResolvedValue('ready');

  await render(<BackupStatusRecovery />);

  expect(
    await screen.findByText(/백업을 위한 데이터 준비를 마쳤어요/u),
  ).toBeTruthy();
  expect(
    screen.getByText('설정 > 사용자 이름 > iCloud > iCloud 백업'),
  ).toBeTruthy();
  expect(screen.queryByText(/^백업 완료$/u)).toBeNull();
});

test('shows recovery guidance and keeps a retry available when a restored key is missing', async () => {
  jest.mocked(prepareBackupSupport).mockResolvedValue('recoveryRequired');

  await render(<BackupStatusRecovery />);

  expect(
    await screen.findByText(/새 데이터베이스를 만들지 않았어요/u),
  ).toBeTruthy();
  expect(screen.getByText('다시 확인')).toBeTruthy();
});

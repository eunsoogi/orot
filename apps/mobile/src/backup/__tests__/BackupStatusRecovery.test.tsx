import { fireEvent, render, screen } from '@testing-library/react-native';
import BackupStatusRecovery from '../BackupStatusRecovery';

test('labels local eligibility without presenting it as iCloud backup completion', async () => {
  const onRetry = jest.fn(async () => undefined);
  await render(<BackupStatusRecovery state="ready" onRetry={onRetry} />);

  expect(screen.getByText(/백업을 위한 데이터 준비를 마쳤어요/u)).toBeTruthy();
  expect(
    screen.getByText('설정 > 사용자 이름 > iCloud > iCloud 백업'),
  ).toBeTruthy();
  expect(screen.queryByText(/^백업 완료$/u)).toBeNull();
  await fireEvent.press(screen.getByTestId('backup-prepare'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('shows recovery guidance and keeps a retry available when a restored key is missing', async () => {
  const onRetry = jest.fn(async () => undefined);

  await render(
    <BackupStatusRecovery state="recoveryRequired" onRetry={onRetry} />,
  );

  expect(screen.getByText(/새 데이터베이스를 만들지 않았어요/u)).toBeTruthy();
  await fireEvent.press(screen.getByText('백업 준비'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

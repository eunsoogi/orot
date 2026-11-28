import { render, screen, within } from '@testing-library/react-native';
import { RecordsHeading } from '../RecordsRouteEntries';

test('keeps the title and recording action in a single scalable heading without a banner', async () => {
  await render(<RecordsHeading onOpenRecording={jest.fn()} />);
  const heading = within(screen.getByTestId('records-hub-header'));
  const title = heading.getByRole('header', { name: '기록' });
  expect(title.props.maxFontSizeMultiplier).toBeUndefined();
  expect(heading.getByRole('button', { name: '새 상담 녹음' })).toBeVisible();
  expect(screen.queryByTestId('records-subtitle')).toBeNull();
  expect(screen.queryByTestId('records-section-tabs')).toBeNull();
});

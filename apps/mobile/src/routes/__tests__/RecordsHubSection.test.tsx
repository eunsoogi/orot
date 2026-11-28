import { render, screen } from '@testing-library/react-native';
import { View } from 'react-native';
import { RecordsHubSection } from '../RecordsHubSection';

test('keeps exactly one route scroll host without a horizontal tab control', async () => {
  await render(
    <RecordsHubSection>
      <View testID="records-home-content" />
    </RecordsHubSection>,
  );
  const [scroll] = screen.getAllByTestId('navigation-route-scroll');
  expect(screen.getAllByTestId('navigation-route-scroll')).toHaveLength(1);
  expect(scroll).toContainElement(screen.getByTestId('records-home-content'));
  expect(screen.queryByTestId('records-section-tabs')).toBeNull();
});

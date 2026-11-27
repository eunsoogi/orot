import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, Switch } from 'react-native';
import { SettingsMemoryControl } from '../SettingsMemoryControl';

test('the title, separate info and native switch share the same vertically centered row', async () => {
  await render(
    <SettingsMemoryControl
      title="Test setting"
      description={['Information']}
      control={<Switch testID="sample-switch" />}
      testID="sample"
    />,
  );
  const row = screen.getByTestId('sample-row');
  expect(StyleSheet.flatten(row.props.style)).toMatchObject({
    flexDirection: 'row',
    alignItems: 'center',
  });
  expect(within(row).getByTestId('sample-title')).toHaveTextContent(
    'Test setting',
  );
  expect(within(row).getByTestId('sample-info')).toBeVisible();
  expect(within(row).getByTestId('sample-switch')).toBeVisible();
});

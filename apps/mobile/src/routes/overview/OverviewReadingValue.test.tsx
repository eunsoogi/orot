import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { AppText as Text } from '../../layout/AppText';
import { OverviewReadingValue } from './OverviewReadingValue';

test.each([
  ['8,426걸음', ['걸음']],
  ['66 BPM', [' BPM']],
  ['7시간 22분', ['시간 ', '분']],
  ['70.4 kg', [' kg']],
  ['١٬٤٢٦ خطوة', [' خطوة']],
] as const)(
  'keeps %s intact while rendering each unit smaller than its number',
  async (formatted, units) => {
    await render(
      <Text style={{ fontSize: 38 }} testID="headline">
        <OverviewReadingValue formatted={formatted} />
      </Text>,
    );
    expect(screen.getByTestId('headline')).toHaveTextContent(formatted);
    for (const unit of units) {
      expect(
        StyleSheet.flatten(screen.getByText(unit).props.style).fontSize,
      ).toBe(22);
    }
  },
);

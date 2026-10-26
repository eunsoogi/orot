import { fireEvent, render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { AdaptiveColumns } from '../AdaptiveColumns';

function StatefulPanel({
  name,
  onStartRequest,
}: {
  readonly name: string;
  readonly onStartRequest: () => void;
}) {
  const [draft, setDraft] = useState('');
  const [selected, setSelected] = useState(false);
  useEffect(() => {
    onStartRequest();
  }, [onStartRequest]);

  return (
    <View>
      <TextInput
        onChangeText={setDraft}
        testID={`${name}-draft`}
        value={draft}
      />
      <Pressable
        onPress={() => setSelected(value => !value)}
        testID={`${name}-selection`}
      >
        <Text testID={`${name}-selection-label`}>
          {selected ? 'selected' : 'unselected'}
        </Text>
      </Pressable>
    </View>
  );
}

function TestPanels({
  startPrimary,
  startSecondary,
}: {
  readonly startPrimary: () => void;
  readonly startSecondary: () => void;
}) {
  return (
    <AdaptiveColumns
      primary={<StatefulPanel name="primary" onStartRequest={startPrimary} />}
      secondary={
        <StatefulPanel name="secondary" onStartRequest={startSecondary} />
      }
    />
  );
}

function axis(testID: string): string | undefined {
  return StyleSheet.flatten(screen.getByTestId(testID).props.style)
    ?.flexDirection;
}

test('reflows mounted panels while retaining drafts, selection, and request owners', async () => {
  const startPrimary = jest.fn();
  const startSecondary = jest.fn();
  await render(
    <TestPanels startPrimary={startPrimary} startSecondary={startSecondary} />,
  );

  expect(axis('adaptive-columns')).toBe('column');
  await fireEvent.changeText(
    screen.getByTestId('primary-draft'),
    'question draft',
  );
  await fireEvent.press(screen.getByTestId('secondary-selection'));
  await fireEvent(screen.getByTestId('adaptive-columns'), 'layout', {
    nativeEvent: { layout: { width: 1400, height: 600, x: 0, y: 0 } },
  });

  expect(axis('adaptive-columns')).toBe('row');
  expect(screen.getByTestId('primary-draft').props.value).toBe(
    'question draft',
  );
  expect(screen.getByTestId('secondary-selection-label').props.children).toBe(
    'selected',
  );
  expect(startPrimary).toHaveBeenCalledTimes(1);
  expect(startSecondary).toHaveBeenCalledTimes(1);

  await fireEvent(screen.getByTestId('adaptive-columns'), 'layout', {
    nativeEvent: { layout: { width: 1200, height: 600, x: 0, y: 0 } },
  });

  expect(axis('adaptive-columns')).toBe('column');
  expect(screen.getByTestId('primary-draft').props.value).toBe(
    'question draft',
  );
  expect(startPrimary).toHaveBeenCalledTimes(1);
  expect(startSecondary).toHaveBeenCalledTimes(1);
});

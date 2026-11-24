import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { OpenAiVoicePairForm } from '../OpenAiVoicePairForm';

const panes = {
  speech: <Text>synthetic speech model</Text>,
  preferences: <Text>synthetic language/voice</Text>,
  tools: <Text>synthetic tool model</Text>,
};
test('hides all three OpenAI API sections without a fresh eligible catalog', async () => {
  const view = await render(
    <OpenAiVoicePairForm {...panes} fresh={false} eligible={false} />,
  );
  expect(view.queryByTestId('openai-voice-pair-form')).toBeNull();
  await view.rerender(
    <OpenAiVoicePairForm {...panes} fresh eligible={false} />,
  );
  expect(view.queryByTestId('openai-voice-pair-form')).toBeNull();
  await view.rerender(<OpenAiVoicePairForm {...panes} fresh eligible />);
  expect(view.getByText('synthetic speech model')).toBeVisible();
  expect(view.getByText('synthetic language/voice')).toBeVisible();
  expect(view.getByText('synthetic tool model')).toBeVisible();
  expect(view.queryByRole('tab')).toBeNull();
  expect(
    view
      .getByTestId('openai-voice-pair-form')
      .children.map(node =>
        typeof node === 'string' ? '' : node.props.testID,
      ),
  ).toEqual([
    'openai-voice-speech',
    'openai-voice-preferences',
    'openai-voice-tools',
  ]);
  await view.rerender(
    <OpenAiVoicePairForm {...panes} fresh={false} eligible />,
  );
  expect(view.queryByText('synthetic speech model')).toBeNull();
  expect(view.queryByText('synthetic language/voice')).toBeNull();
  expect(view.queryByText('synthetic tool model')).toBeNull();
});

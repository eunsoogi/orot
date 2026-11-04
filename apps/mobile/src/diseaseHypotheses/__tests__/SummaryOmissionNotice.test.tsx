import { render, screen } from '@testing-library/react-native';
import { DiseaseHypothesesScreenOutput } from '../DiseaseHypothesesScreenOutput';
import { hypothesis } from '../taskTestSupport';

test('shows a separate omission notice without changing retained uncertainty', async () => {
  await render(
    <DiseaseHypothesesScreenOutput
      state={{
        status: 'result',
        value: {
          presentation: 'symptom_summary',
          omittedUnsupportedContent: true,
          hypotheses: [
            hypothesis({ uncertainty: '기록된 기간에 한정돼요.' }),
          ] as never,
        },
      }}
      activity={undefined}
      preview=""
      lastOperation="summary"
      hasSharedCancel={false}
      onCancel={jest.fn()}
      onOpenSource={jest.fn()}
    />,
  );
  expect(
    screen.getByTestId('symptom-summary-omitted-content'),
  ).toHaveTextContent('일부 내용은 근거를 확인할 수 없어 제외했어요.');
  expect(screen.getByText('기록된 기간에 한정돼요.')).toBeTruthy();
});

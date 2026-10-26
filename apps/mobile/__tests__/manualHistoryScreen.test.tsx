import {
  fireEvent,
  render,
  waitFor,
  within,
} from '@testing-library/react-native';
import ManualHistoryScreen from '../src/manualHistory/ManualHistoryScreen';
import { createManualHistoryTestRepository } from '../test-support/manualHistoryTestRepository';

describe('ManualHistoryScreen', () => {
  it.each([
    ['diagnosis_history', '진단 또는 과거 병력'],
    ['procedure', '시술 또는 수술'],
    ['medication_context', '복용약 관련 내용'],
    ['note', '자유 메모'],
  ] as const)('offers the %s manual entry type', async (kind, label) => {
    const view = await render(
      <ManualHistoryScreen
        onBack={jest.fn()}
        repository={createManualHistoryTestRepository()}
      />,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.press(view.getByTestId('manual-history-kind-' + kind));

    expect(view.getByText('✓ ' + label)).toBeTruthy();
  });

  it('accepts and displays an explicitly known effective date', async () => {
    const view = await render(
      <ManualHistoryScreen
        onBack={jest.fn()}
        repository={createManualHistoryTestRepository()}
      />,
    );
    await view.findByTestId('manual-history-empty');
    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic dated history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details for the known-date component test.',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(
      await view.findByText(
        '올바른 기준일을 입력하거나 기준일 모름을 선택해 주세요.',
      ),
    ).toBeTruthy();

    await fireEvent.changeText(
      view.getByTestId('manual-history-effective-date-input'),
      '2024-02-09',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(await view.findByText('Synthetic dated history')).toBeTruthy();
    expect(view.getByText('기준일: 2024-02-09')).toBeTruthy();
    expect(view.getByText('직접 입력 · 미확인')).toBeTruthy();
  });

  it('requires explicit date knowledge and presents corrected history', async () => {
    const repository = createManualHistoryTestRepository();
    const view = await render(
      <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
    );
    await view.findByTestId('manual-history-empty');

    await fireEvent.press(view.getByTestId('manual-history-add'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic test history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic details for component coverage.',
    );
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(
      await view.findByText(
        '올바른 기준일을 입력하거나 기준일 모름을 선택해 주세요.',
      ),
    ).toBeTruthy();

    await fireEvent.press(view.getByTestId('manual-history-date-unknown'));
    await fireEvent.press(view.getByTestId('manual-history-save'));
    expect(
      await view.findByTestId('manual-history-entry-synthetic-entry-1'),
    ).toBeTruthy();
    expect(view.getByText('기준일을 모름')).toBeTruthy();
    expect(view.getByText('직접 입력 · 미확인')).toBeTruthy();

    await fireEvent.press(
      view.getByTestId('manual-history-details-synthetic-entry-1'),
    );
    await waitFor(() =>
      expect(view.getByTestId('manual-history-detail')).toBeTruthy(),
    );
    await fireEvent.press(view.getByTestId('manual-history-correct'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Corrected synthetic test history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Corrected synthetic details for component coverage.',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-correction-note-input'),
      'Corrected wording only.',
    );
    await fireEvent.press(view.getByTestId('manual-history-kind-procedure'));
    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(
      await view.findByTestId('manual-history-correction-history'),
    ).toBeTruthy();
    expect(view.getByText('이전 내용')).toBeTruthy();
    expect(view.getByText('현재 내용')).toBeTruthy();
    expect(
      view.getByTestId('manual-history-version-synthetic-entry-1'),
    ).toBeTruthy();
    expect(
      view.getByTestId('manual-history-version-synthetic-entry-2'),
    ).toBeTruthy();
    expect(
      view.getByTestId('manual-history-entry-synthetic-entry-2'),
    ).toBeTruthy();
    expect(
      view.queryByTestId('manual-history-entry-synthetic-entry-1'),
    ).toBeNull();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-1'),
      ).getByText('진단 또는 과거 병력'),
    ).toBeTruthy();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-1'),
      ).getByText('직접 입력 · 미확인'),
    ).toBeTruthy();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-1'),
      ).getByText(
        '기록 시각: ' + new Date('2026-09-15T10:20:00Z').toLocaleString(),
      ),
    ).toBeTruthy();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-2'),
      ).getByText('시술 또는 수술'),
    ).toBeTruthy();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-2'),
      ).getByText('직접 입력 · 미확인'),
    ).toBeTruthy();
    expect(
      within(
        view.getByTestId('manual-history-version-synthetic-entry-2'),
      ).getByText(
        '기록 시각: ' + new Date('2026-09-16T11:20:00Z').toLocaleString(),
      ),
    ).toBeTruthy();
    expect(view.getByText('수정 메모: Corrected wording only.')).toBeTruthy();
  });

  it('keeps a saved correction visible if refreshing its history fails', async () => {
    const repository = createManualHistoryTestRepository();
    const original = await repository.create({
      kind: 'note',
      title: 'Synthetic history before correction',
      details: 'Synthetic original details.',
      effectiveDate: { status: 'unknown' },
    });
    const view = await render(
      <ManualHistoryScreen onBack={jest.fn()} repository={repository} />,
    );
    await view.findByTestId('manual-history-entry-' + original.id);
    await fireEvent.press(
      view.getByTestId('manual-history-details-' + original.id),
    );
    await view.findByTestId('manual-history-detail');
    await fireEvent.press(view.getByTestId('manual-history-correct'));
    await fireEvent.changeText(
      view.getByTestId('manual-history-title-input'),
      'Synthetic corrected history',
    );
    await fireEvent.changeText(
      view.getByTestId('manual-history-details-input'),
      'Synthetic corrected details.',
    );
    jest
      .spyOn(repository, 'history')
      .mockRejectedValueOnce(new Error('Synthetic read failure.'));

    await fireEvent.press(view.getByTestId('manual-history-save'));

    expect(
      await view.findByText('수정 내용을 저장했어요. 이전 내용도 보존했어요.'),
    ).toBeTruthy();
    expect(
      await view.findByText(
        '수정 내용은 저장했지만 이력을 불러오지 못했어요. 다시 열어 확인해 주세요.',
      ),
    ).toBeTruthy();
    expect(
      view.getByTestId('manual-history-entry-synthetic-entry-2'),
    ).toBeTruthy();
    expect(
      view.queryByText('건강 기록을 저장하지 못했어요. 다시 시도해 주세요.'),
    ).toBeNull();
  });
});

import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { appColors } from '../../layout/appColors';
import { ManualVisitRecords } from '../ManualVisitRecords';
import type { ManualVisitRecords as Service } from '../manualVisitRecordService';

test.each([true, false, undefined])(
  'manual panel embedded=%s keeps full question text and the existing confirmation action',
  async embedded => {
    const questions = [
      '진료 전에 확인할 사항과 설명이 필요한 내용을 충분히 담은 긴 합성 질문',
      '다음 진료에서 확인할 또 다른 합성 질문',
    ];
    const open = async () =>
      ({
        load: async () =>
          questions.map((questionText, index) => ({
            question: { id: 'synthetic-' + index, questionText },
            revision: 'v1:1',
            records: [],
          })),
        saveManual: jest.fn(),
        edit: jest.fn(),
      }) as unknown as Service;
    await render(
      <ManualVisitRecords
        appointmentId="visit"
        embedded={embedded}
        open={open}
      />,
    );
    await screen.findByText(questions[0]!);
    const panel = StyleSheet.flatten(
      screen.getByTestId('manual-visit-records').props.style,
    );
    expect(panel.padding).toBe(embedded ? 16 : 20);
    expect(panel.gap).toBe(embedded ? 0 : 12);
    expect(panel.backgroundColor).toBe(
      embedded ? appColors.surface : undefined,
    );
    expect(
      screen.getAllByRole('header', { name: '준비한 진료 질문' }),
    ).toHaveLength(1);
    const rows = screen.getAllByTestId('manual-visit-question-row');
    expect(rows).toHaveLength(questions.length);
    for (const [i, row] of rows.entries()) {
      const question = within(row).getByText(questions[i]!);
      expect(question.props.numberOfLines).toBeUndefined();
      const style = StyleSheet.flatten(row.props.style);
      const control = within(row).getByRole('button', {
        name: '실제로 물어봤어요',
      });
      const action = StyleSheet.flatten(control.props.style);
      expect(action.minHeight).toBeGreaterThanOrEqual(44);
      expect(action.minWidth).toBeGreaterThanOrEqual(44);
      if (embedded) {
        expect(style.backgroundColor).toBeUndefined();
        expect(style.borderTopWidth).toBeGreaterThan(0);
        expect(action.alignSelf).toBe('flex-end');
        expect(action.backgroundColor).toBe('transparent');
      } else expect(style.backgroundColor).toBe(appColors.surface);
    }
  },
);

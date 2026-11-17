import { render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { ManualVisitRecords } from '../ManualVisitRecords';
import type { ManualVisitRecords as Service } from '../manualVisitRecordService';

// The Overview supplies its gutter once; standalone callers retain their inset.
test.each([true, false, undefined])(
  'manual panel embedded=%s preserves card interior and removes only duplicate padding',
  async embedded => {
    const open = async () =>
      ({
        load: async () => [
          {
            question: { id: 'synthetic', questionText: '합성 질문' },
            revision: 'v1:1',
            records: [],
          },
        ],
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
    await screen.findByText('합성 질문');
    const panel = StyleSheet.flatten(
      screen.getByTestId('manual-visit-records').props.style,
    );
    expect(panel.padding).toBe(embedded ? 0 : 20);
    expect(panel.gap).toBe(12);
    expect(screen.getByText('실제로 물어봤어요')).toBeTruthy();
  },
);

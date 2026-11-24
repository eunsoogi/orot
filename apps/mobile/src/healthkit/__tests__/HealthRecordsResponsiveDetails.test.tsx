import { act, fireEvent, render, within } from '@testing-library/react-native';
import { Dimensions } from 'react-native';
import { HealthRecordsCategoryCard } from '../HealthRecordsCategoryCard';
import { HealthRecordsMedicationCategoryCard } from '../HealthRecordsMedicationCategoryCard';
import { healthRecordCategories } from '../healthRecordsLibraryModel';

test('every card keeps one details action after the body when narrow and in the medication header when wide', async () => {
  const original = Dimensions.get('window');
  Dimensions.set({ window: { ...original, fontScale: 1 } });
  const open = jest.fn();
  try {
    for (const category of healthRecordCategories()) {
      const view = await render(
        category === 'medications' ? (
          <HealthRecordsMedicationCategoryCard
            onOpenDetail={open}
            summary={{
              data: { definitions: [], doseEvents: [] },
              status: 'ready',
              reload: jest.fn(),
            }}
          />
        ) : (
          <HealthRecordsCategoryCard
            category={category}
            observations={[]}
            loadState="ready"
            onOpenDetail={open}
          />
        ),
      );
      const id = 'health-record-open-detail-' + category;
      const bottom = () => view.getByTestId('health-record-details-bottom');
      expect(within(bottom()).getByTestId(id)).toBeTruthy();
      const heading = view.getByTestId('health-record-category-heading');
      await act(async () =>
        fireEvent(heading, 'layout', {
          nativeEvent: { layout: { width: 540 } },
        }),
      );
      const inline = view.getByTestId('health-record-details-inline');
      const details = within(inline).getByTestId(id);
      expect(view.getAllByTestId(id)).toHaveLength(1);
      expect(view.queryByTestId('health-record-details-bottom')).toBeNull();
      await fireEvent.press(details);
      expect(open).toHaveBeenLastCalledWith({ category, period: 'month' });
      await act(async () =>
        Dimensions.set({ window: { ...original, fontScale: 1.4 } }),
      );
      expect(within(bottom()).getByTestId(id)).toBeTruthy();
      await view.unmount();
      await act(async () =>
        Dimensions.set({ window: { ...original, fontScale: 1 } }),
      );
    }
  } finally {
    Dimensions.set({ window: original });
  }
});

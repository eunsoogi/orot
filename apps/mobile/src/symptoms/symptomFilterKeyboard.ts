import { Platform } from 'react-native';

/** Identifies the keyboard accessories owned by the period fields. */
const FILTER_INPUT_ACCESSORY_IDS = {
  fromDate: 'symptom-filter-accessory-from-date',
  fromTime: 'symptom-filter-accessory-from-time',
  throughDate: 'symptom-filter-accessory-through-date',
  throughTime: 'symptom-filter-accessory-through-time',
};
export const FILTER_KEYBOARD_FIELDS = [
  { nativeID: FILTER_INPUT_ACCESSORY_IDS.fromDate, testSuffix: 'from-date' },
  { nativeID: FILTER_INPUT_ACCESSORY_IDS.fromTime, testSuffix: 'from-time' },
  {
    nativeID: FILTER_INPUT_ACCESSORY_IDS.throughDate,
    testSuffix: 'through-date',
  },
  {
    nativeID: FILTER_INPUT_ACCESSORY_IDS.throughTime,
    testSuffix: 'through-time',
  },
];

type FilterInputKey = keyof typeof FILTER_INPUT_ACCESSORY_IDS;

export function filterInputAccessoryID(
  field: FilterInputKey,
): string | undefined {
  return Platform.OS === 'ios' ? FILTER_INPUT_ACCESSORY_IDS[field] : undefined;
}

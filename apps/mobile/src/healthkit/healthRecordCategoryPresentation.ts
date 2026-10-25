import { appColors } from '../layout/appColors';
import type { HealthRecordCategory } from './healthRecordsLibraryModel';

/** Shares category symbols and appearance-aware tints between the chips and summary cards. */
export const healthRecordCategoryPresentation: Record<
  HealthRecordCategory,
  {
    symbol: string;
    color: typeof appColors.text;
    background: typeof appColors.surface;
  }
> = {
  blood_pressure: {
    symbol: 'heart.fill',
    color: appColors.pink,
    background: appColors.pinkSoft,
  },
  heart_rate: {
    symbol: 'heart',
    color: appColors.pink,
    background: appColors.pinkSoft,
  },
  steps: {
    symbol: 'shoe',
    color: appColors.primaryText,
    background: appColors.primarySoft,
  },
  body_mass: {
    symbol: 'scalemass',
    color: appColors.purple,
    background: appColors.purpleSoft,
  },
  sleep: {
    symbol: 'bed.double',
    color: appColors.purple,
    background: appColors.purpleSoft,
  },
  medications: {
    symbol: 'pills',
    color: appColors.primaryText,
    background: appColors.primarySoft,
  },
  other: {
    symbol: 'doc.text',
    color: appColors.secondary,
    background: appColors.background,
  },
};

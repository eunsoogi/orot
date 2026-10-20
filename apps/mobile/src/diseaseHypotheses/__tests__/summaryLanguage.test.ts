import { summaryLanguageShape } from '../summaryLanguage';

test.each([
  ['   ', 'blank'],
  ['—', 'symbols'],
  ['1.5 %', 'numeric'],
  ['REM', 'latin_token'],
  ['None', 'latin_token'],
  ['N/A', 'latin_token'],
  ['82 mmHg', 'latin_numbers'],
  ['No additional data', 'latin_phrase'],
  ['情報不足', 'other'],
])(
  'classifies only the structure of %s, without accepting or rewriting it',
  (text, shape) => {
    expect(summaryLanguageShape(text)).toBe(shape);
  },
);

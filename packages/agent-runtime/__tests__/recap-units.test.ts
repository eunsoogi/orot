import { recapInput } from './recap-fixtures';
import { recapUnitChunks, recapUnits, resolveRecapUnit } from '../src/recap/units';

it('retains exact UTF-16 ranges for repeated text and surrogate pairs', () => {
  const input = recapInput('질문😀? 답변. 질문😀? 답변.');
  const units = recapUnits(input);
  expect(units.map((unit) => unit.text).join('')).toBe(input.segments[0].text);
  expect(new Set(units.map((unit) => unit.ref)).size).toBe(units.length);
  for (const unit of units) {
    expect(input.segments[0].text.slice(unit.startOffset, unit.endOffset)).toBe(unit.text);
    expect(/^[\uDC00-\uDFFF]|[\uD800-\uDBFF]$/.test(unit.text)).toBe(false);
  }
});

it('resolves only supplied references against the unchanged source snapshot', () => {
  const input = recapInput('질문😀? 답변.');
  const units = recapUnits(input);
  expect(resolveRecapUnit(input, units, units[0].ref)).toMatchObject({
    quote: units[0].text,
    revision: input.segments[0].revision,
    audioRange: input.segments[0].audioRange,
  });
  expect(() => resolveRecapUnit(input, units, 'foreign')).toThrow();
  const changed = recapInput('다른 원문');
  expect(() => resolveRecapUnit(changed, units, units[0].ref)).toThrow();
});

it('bounds unpunctuated fragments without dropping text', () => {
  const input = recapInput('가'.repeat(700) + '😀' + '나'.repeat(700));
  const units = recapUnits(input);
  expect(units.every((unit) => unit.text.length <= 512)).toBe(true);
  expect(units.map((unit) => unit.text).join('')).toBe(input.segments[0].text);
});

it('retains stable references across overlapping chunks', () => {
  const units = recapUnits(recapInput('질문? 답변. '.repeat(30)));
  const chunks = recapUnitChunks(units);
  expect(chunks.length).toBeGreaterThan(1);
  expect(chunks[0][chunks[0].length - 1]).toEqual(chunks[1][0]);
  expect(new Set(chunks.flat().map((unit) => unit.ref)).size).toBe(units.length);
});

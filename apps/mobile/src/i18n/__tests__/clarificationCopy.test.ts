import {
  clarificationQuestions,
  isKnownClarification,
} from '../../agent/visitQuestions/clarificationQuestions';
import { resolveLanguage, supportedLanguages } from '..';

// These are the pre-migration safety-boundary bytes, not a newly translated fixture.
const expected = [
  {
    questionText: '이번 진료에 가져가면 도움이 될 검사 결과나 기록이 있을까요?',
    rationale: '진료에 필요한 자료를 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '확인되지 않은 검사 결과는 어떻게 확인하면 좋을까요?',
    rationale: '확인할 결과와 확인 방법을 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText:
      '기록에 서로 다른 내용이 있다면 어느 자료로 확인하면 좋을까요?',
    rationale: '서로 다른 기록을 확인할 방법을 의료진과 상의할 수 있어요.',
  },
  {
    questionText: '복용하는 약이 있다면 어떤 정보를 준비하면 좋을까요?',
    rationale: '약에 관해 필요한 정보를 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '증상이 있을 때 어떤 내용과 시점을 기록하면 좋을까요?',
    rationale: '증상에 관해 준비할 정보를 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText: '진료 전 확인하거나 준비할 내용이 더 있을까요?',
    rationale: '진료 준비에 필요한 내용을 의료진에게 확인할 수 있어요.',
  },
  {
    questionText: '진료 이후 어떤 변화가 있으면 다시 상담해야 할까요?',
    rationale: '이후 상담이 필요한 상황을 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText: '추가 검사나 확인이 필요한지는 어떻게 결정하나요?',
    rationale: '추가 확인을 결정하는 기준을 의료진에게 물어볼 수 있어요.',
  },
] as const;

// New clinical choices precede, but never rewrite, the original compatibility pairs.
const clinical = [
  {
    questionText:
      '치료나 관리가 필요하다면 어떤 선택지가 있고 장단점은 무엇인가요?',
    rationale:
      '치료가 필요하다고 단정하지 않고 선택 기준을 의료진과 상의할 수 있어요.',
  },
  {
    questionText:
      '증상이 생기거나 달라질 때 어떤 점을 관찰하고 언제 진료를 받아야 하나요?',
    rationale:
      '증상이 있다고 단정하지 않고 관찰할 내용과 진료 시점을 물어볼 수 있어요.',
  },
  {
    questionText:
      '검사가 필요하다면 무엇을 확인하며 결과에 따라 관리 계획이 어떻게 달라지나요?',
    rationale:
      '검사 필요성과 이후 결정에 도움이 되는 정보를 의료진에게 물어볼 수 있어요.',
  },
  {
    questionText:
      '이번 진료 뒤 실천할 관리 방법과 다음 상담 시점은 어떻게 정하면 좋을까요?',
    rationale:
      '구체적인 관리 계획과 추후 상담 시점을 의료진과 함께 정할 수 있어요.',
  },
];
const current = [...clinical, ...expected];
test('preserves original pairs verbatim after the new clinical choices', () => {
  expect(JSON.stringify(clarificationQuestions)).toBe(JSON.stringify(current));
});
test.each(current)(
  'accepts the original pair and rejects altered or cross-paired prose: $questionText',
  row => {
    expect(isKnownClarification(row.questionText, row.rationale)).toBe(true);
    expect(isKnownClarification(`${row.questionText} `, row.rationale)).toBe(
      false,
    );
    expect(isKnownClarification(row.questionText, `${row.rationale} `)).toBe(
      false,
    );
    for (const other of current) {
      if (other !== row)
        expect(isKnownClarification(row.questionText, other.rationale)).toBe(
          false,
        );
    }
  },
);
test('unsupported device locale retains the same list before prompt or validation use', () => {
  const options = new Intl.DateTimeFormat().resolvedOptions();
  const locale = jest
    .spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions')
    .mockReturnValue({ ...options, locale: 'fr-FR' });
  try {
    expect(supportedLanguages).toEqual(['ko']);
    expect(resolveLanguage()).toBe('ko');
    jest.isolateModules(() => {
      const loaded = require('../../agent/visitQuestions/clarificationQuestions');
      expect(JSON.stringify(loaded.clarificationQuestions)).toBe(
        JSON.stringify(current),
      );
      expect(
        loaded.isKnownClarification(
          expected[0].questionText,
          expected[1].rationale,
        ),
      ).toBe(false);
    });
  } finally {
    locale.mockRestore();
  }
});

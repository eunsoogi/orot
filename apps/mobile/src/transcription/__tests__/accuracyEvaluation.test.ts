import { evaluateSyntheticSpeech } from '../accuracyEvaluation';

describe('synthetic Korean transcription accuracy evaluation', () => {
  it('reports exact normalized recognition and medication term retention', () => {
    expect(
      evaluateSyntheticSpeech(
        {
          id: 'medication-name',
          expectedText: '가상 약품 이름은 메트포르민입니다.',
          medicationName: '메트포르민',
        },
        '가상 약품 이름은 메트포르민입니다',
      ),
    ).toMatchObject({
      exactMatchAfterNormalization: true,
      characterErrorRate: 0,
      medicationNameMatched: true,
    });
  });

  it('counts a numeric form as preserved while retaining its character edit distance', () => {
    const numberCase = {
      id: 'number',
      expectedText: '복용량은 오백 밀리그램입니다.',
      numberForms: ['오백 밀리그램', '500 밀리그램', '오백 mg', '500 mg'],
    };
    const result = evaluateSyntheticSpeech(
      numberCase,
      '복용량은 500 밀리그램입니다.',
    );

    expect(result).toMatchObject({
      exactMatchAfterNormalization: false,
      numberMatched: true,
    });
    expect(result.characterErrorRate).toBeGreaterThan(0);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 1500 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 일천오백 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 5.00 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 5,00 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 -500 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 +500 밀리그램입니다.')
        .numberMatched,
    ).toBe(false);
  });

  it('keeps numeric separators meaningful across exact match, character error, and number retention', () => {
    const numberCase = {
      id: 'numeric-dose',
      expectedText: '복용량은 500 mg입니다.',
      numberForms: ['500 mg'],
    };

    for (const recognizedText of [
      '복용량은 5.00 mg입니다.',
      '복용량은 5,00 mg입니다.',
      '복용량은 -500 mg입니다.',
      '복용량은 +500 mg입니다.',
    ]) {
      const result = evaluateSyntheticSpeech(numberCase, recognizedText);
      expect(result).toMatchObject({
        exactMatchAfterNormalization: false,
        numberMatched: false,
      });
      expect(result.characterErrorRate).toBeGreaterThan(0);
    }

    expect(
      evaluateSyntheticSpeech(numberCase, '복용량은 500mg 입니다'),
    ).toMatchObject({
      exactMatchAfterNormalization: true,
      characterErrorRate: 0,
      numberMatched: true,
    });
  });

  it('measures a lost negation and nonzero character edits without claiming clinical accuracy', () => {
    expect(
      evaluateSyntheticSpeech(
        {
          id: 'negation',
          expectedText: '오늘은 약을 복용하지 않았습니다.',
          negationForms: ['복용하지 않았습니다', '복용 안 했습니다'],
        },
        '오늘은 약을 복용했습니다.',
      ),
    ).toMatchObject({
      exactMatchAfterNormalization: false,
      characterErrorRate: expect.any(Number),
      negationMatched: false,
    });
  });

  it('does not count an unrelated word containing the syllable 안 as preserved negation', () => {
    expect(
      evaluateSyntheticSpeech(
        {
          id: 'negation',
          expectedText: '오늘은 약을 복용하지 않았습니다.',
          negationForms: ['복용하지 않았습니다', '복용 안 했습니다'],
        },
        '오늘은 약을 복용했습니다. 하지만 안심했습니다.',
      ),
    ).toMatchObject({
      negationMatched: false,
    });
  });
});

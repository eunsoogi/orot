import { ko } from '../../i18n/ko';
import { recordingKo } from '../../i18n/recordingKo';

describe('recording localization', () => {
  it('registers the complete feature fragment in the shared Korean catalog', () => {
    expect(ko).toMatchObject(recordingKo);
  });
});

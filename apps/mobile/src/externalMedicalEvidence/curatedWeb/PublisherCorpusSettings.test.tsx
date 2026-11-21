import { fireEvent, render, screen } from '@testing-library/react-native';
import { PublisherCorpusSettings } from './PublisherCorpusSettings';
import { appPublisherCorpus } from './appPublisherCorpus';

jest.mock('./appPublisherCorpus', () => ({
  publisherCorpusAvailable: true,
  appPublisherCorpus: { refresh: jest.fn(async () => 'ready') },
}));
jest.mock('../../layout/AppButton', () => ({
  AppButton: ({ title, ...props }: { title: string }) => {
    const { Button } = require('react-native');
    return <Button title={title} {...props} />;
  },
}));

test('refresh requires a user press after source and data disclosure', async () => {
  await render(<PublisherCorpusSettings />);
  expect(screen.getByText('웹검색')).toBeTruthy();
  expect(screen.getByText(/MedlinePlus의 공개 건강 문서 6개/)).toBeTruthy();
  expect(screen.getByText(/대화나 검색어는 보내지 않아요/)).toBeTruthy();
  expect(appPublisherCorpus.refresh).not.toHaveBeenCalled();
  await fireEvent.press(screen.getByTestId('publisher-corpus-refresh'));
  expect(appPublisherCorpus.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/검색 자료를 준비했어요/)).toBeTruthy();
});

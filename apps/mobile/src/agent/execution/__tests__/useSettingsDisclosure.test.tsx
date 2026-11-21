import { act, renderHook } from '@testing-library/react-native';
import { useSettingsDisclosure } from '../useSettingsDisclosure';

const summary = {
  providerId: 'openai-live',
  modelId: 'gpt-live-1.1',
  recipient: 'OpenAI Live API',
  subtitle: 'Synthetic title',
  information: 'Synthetic scope',
  notice: 'Synthetic notice',
};

it('rejects competing and aborted decisions and cannot accept an old callback for the same summary', async () => {
  const form = await renderHook(useSettingsDisclosure);
  const signal = new AbortController();
  let first!: Promise<boolean>;
  await act(async () => {
    first = form.result.current.confirmDisclosure(summary, signal.signal);
  });
  const obsolete = form.result.current.disclosureSheet?.props.onDecision;
  expect(obsolete).toBeDefined();
  await expect(form.result.current.confirmDisclosure(summary)).resolves.toBe(
    false,
  );
  await act(async () => signal.abort());
  await expect(first).resolves.toBe(false);
  expect(form.result.current.disclosureSheet).toBeNull();
  let second!: Promise<boolean>;
  await act(async () => {
    second = form.result.current.confirmDisclosure(summary);
  });
  await act(async () => obsolete(true));
  expect(form.result.current.disclosureSheet).not.toBeNull();
  await act(async () =>
    form.result.current.disclosureSheet?.props.onDecision(true),
  );
  await expect(second).resolves.toBe(true);
});

it('contains a summary only and unmount cannot grant permission', async () => {
  const form = await renderHook(useSettingsDisclosure);
  let pending!: Promise<boolean>;
  await act(async () => {
    pending = form.result.current.confirmDisclosure(summary);
  });
  expect(form.result.current.disclosureSheet?.props.summary).toEqual(summary);
  expect(form.result.current.disclosureSheet?.props.request).toBeUndefined();
  await form.unmount();
  await expect(pending).resolves.toBe(false);
});

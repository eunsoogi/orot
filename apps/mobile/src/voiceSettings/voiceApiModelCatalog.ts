/** Explicit catalog refresh only. Account access stays in the device credential store. */
export async function discoverApiModels(
  signal: AbortSignal,
  snapshot: () => Promise<{ revision: number; apiKey: string }>,
  isCurrent: (revision: number) => Promise<boolean>,
): Promise<{ revision: number; ids: string[] }> {
  const { revision, apiKey } = await snapshot();
  const value = { apiKey };
  if (signal.aborted || !(await isCurrent(revision)))
    throw new Error('account-changed');
  if (!value.apiKey) throw new Error('no-account');
  if (value.apiKey.length > 4096 || !/^[\x21-\x7e]+$/.test(value.apiKey))
    throw new Error('access');
  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/models', {
      headers: { Authorization: `Bearer ${value.apiKey}` },
      signal,
      redirect: 'error',
    });
  } catch {
    throw new Error('network');
  }
  // RN iOS drops original headers on redirects; also reject redirected results.
  // Do not treat fetch's redirect option alone as an enforced native boundary.
  if (response.url !== 'https://api.openai.com/v1/models')
    throw new Error('redirect');
  if (response.status === 401 || response.status === 403)
    throw new Error('access');
  if (response.status === 429) throw new Error('rate-limit');
  if (!response.ok) throw new Error('server');
  let payload: { data?: { id?: unknown }[] };
  try {
    payload = await response.json();
  } catch {
    throw new Error('invalid');
  }
  if (!Array.isArray(payload?.data)) throw new Error('invalid');
  if (!(await isCurrent(revision))) throw new Error('account-changed');
  return {
    revision,
    ids: [
      ...new Set(
        payload.data.flatMap(item =>
          typeof item?.id === 'string' &&
          /^[a-zA-Z0-9._-]{1,200}$/.test(item.id)
            ? [item.id]
            : [],
        ),
      ),
    ],
  };
}

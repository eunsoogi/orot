# Connected API voice models

Issue: #840. This change moves credential management into Connected Accounts and
keeps voice model selection separate from authentication.

The existing `com.orot.mobile.voice-settings.v1` Keychain item remains the single
authoritative credential store. No credential copy or destructive migration is
needed, including for existing installations. Atomic writes preserve the model
selection and use `WHEN_UNLOCKED_THIS_DEVICE_ONLY`. Disconnecting does not silently
select local processing. ChatGPT subscription accounts are separate from this
single OpenAI API credential connection.

The explicit refresh action requests only `GET https://api.openai.com/v1/models`.
It does not start a Realtime session, capture audio or send conversation content.
Model IDs are intersected with the app's runtime compatibility allowlist. That
allowlist alone is never rendered as account availability. Unknown models are not
assumed compatible. Discovery cannot prove session entitlement, quota or successful
audio operation. See the provider's [model availability guidance](https://developers.openai.com/api/docs/guides/rate-limits#model-availability).

Catalogs are memory-only, scoped to the credential revision and explicitly marked
stale after a refresh failure. Replacement/disconnection invalidates pending
responses. A saved selection absent from the latest list stays unchanged and is
explained; selecting and saving an API model requires a fresh compatible entry.
The store rejects selection writes tied to an obsolete account revision.

## Verification

Deterministic mocked tests cover credential reuse, atomic replacement failure,
disconnection without fallback, revision-bound selection, model response parsing,
authentication/access/rate-limit errors, stale lists, empty results, late replies,
explicit refresh, secret-entry placement, account navigation and bounded Korean
copy without middle dots. They do not prove live provider availability or native
Keychain behavior. The existing service identifier and native accessibility
protection are preserved.

Local checks: 21 provider/voice suites, 83 tests; app TypeScript; changed-file ESLint;
Prettier and source LOC policy. No real credential, provider request, microphone,
physical device, paid session or release is used for this verification. Required
remote PR checks remain necessary and are not replaced by these focused results.

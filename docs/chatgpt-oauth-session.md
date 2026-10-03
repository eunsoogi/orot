# ChatGPT OAuth sessions

This note describes the persisted session flow in `packages/provider-openai`. The earlier [OAuth spike notes](chatgpt-oauth-spike.md) record issue #8's browser and callback observations; this document covers issue #9's credential lifecycle.

## Stored account record

`KeychainChatGPTCredentialStore` stores one generic-password Keychain item per issued client ID. The item contains the issued client ID, stable host ID, validated ID-token subject, granted scopes, expiry, and current access, refresh, and ID tokens. Keychain accessibility is `WhenUnlockedThisDeviceOnly`. A separate Keychain item preserves the host ID across launches.

The client ID returned by first-time registration is the account key. `dynamic_agent_client` is used only to start a new registration. Returning sign-in reuses the selected account's issued client ID, host ID, and retained ID token hint. A newly verified subject must match the selected account before the stored record is replaced.

The package's default OAuth HTTP session is ephemeral, with URL cache and cookies disabled. Callers that inject a `URLSession` are responsible for providing an equally private configuration. Tokens are not written to logs, analytics, or source control. The retained ID token is sent only as `id_token_hint` to the OpenAI authorization endpoint; authorization URLs containing it must not be logged.

## Refresh and sign-out

`ChatGPTSessionManager` refreshes within 60 seconds of expiry. Its actor coalesces overlapping requests for the same issued client ID into one refresh task. The form request uses the issued client ID, current refresh token, and `resource=https://api.openai.com/v1`; it omits `scope`. A successful response replaces the access token, expiry, returned scope set, and rotating refresh token together in Keychain.

Transient refresh errors preserve the stored credentials. Terminal unusable-token responses clear the access, refresh, and ID tokens while retaining the account and host mapping so the user can sign in again. Sign-out waits for an in-flight refresh, attempts remote revocation with bounded backoff for network failures and 5xx responses, then clears local credentials even if remote revocation cannot be confirmed. The result distinguishes confirmed revocation from local-only cleanup.

## Verification

Run the provider package tests:

```sh
swift test --package-path packages/provider-openai
```

The tests use synthetic token fixtures and a stub HTTP transport. They cover validated sign-in persistence, account-identity mismatch, twelve simultaneous refresh callers sharing one rotating-token request, transient refresh failure, terminal `invalid_grant`, and sign-out cleanup after revocation failure. They do not contact OpenAI or prove Keychain behavior on iOS.

The Debug-only actions in the iOS spike use a fixed synthetic record. Tap **1. 합성 Keychain 계정 저장**, terminate and relaunch the app, then tap **2. 재실행 후 확인·로그아웃·정리**. The second action reads the Keychain item through a new store instance, verifies the account identity and granted scope, clears the credentials while retaining the account mapping, and removes the fixture. Neither action signs in or makes a network request.

The standalone Debug harness built and passed this lifecycle on an iPhone 17e Simulator running iOS 27.0. The UI confirmed that the synthetic Keychain item could be read after relaunch and that sign-out removed the tokens and account fixture. The portable package tests passed all 23 tests. These checks do not prove a real OAuth callback, token exchange, or `/v1/models` response.

Interactive account authentication was waived for this handoff because the login path required additional MFA. No real callback, token exchange, granted direct-plan scope, or `/v1/models` response is claimed. The earlier issue #8 Simulator report remains in [the spike notes](chatgpt-oauth-spike.md).

## OpenAI references

- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)

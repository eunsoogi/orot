# Sign in with ChatGPT iOS spike

This is an isolated feasibility harness for [issue #8](https://github.com/eunsoogi/orot/issues/8). It does not connect the React Native app, implement model inference, or claim production account management.

## Flow under test

The `OpenAIProvider` Swift package follows OpenAI's documented local and personal-app flow:

1. Keep a stable `urn:uuid:` `ext_agent_host_id` in local preferences.
2. Discover the OpenID endpoints from `https://auth.openai.com/.well-known/openid-configuration` and accept only HTTPS endpoints on `auth.openai.com`.
3. Create a fresh PKCE S256 verifier/challenge, state, and nonce for each attempt. Start an HTTP listener on IPv4 loopback and use `http://127.0.0.1:<ephemeral-port>/auth/callback` as the redirect URI.
4. Open the authorization URL in the system browser. Require the callback state to match, reject denial/error responses and incomplete dynamic registration, then exchange the code using the same redirect URI and verifier.
5. Verify the returned ID token with JWTKit's RS256/JWKS support, selecting only keys intended for signature verification when JWK `use` or `key_ops` metadata is provided; check issuer, audience, expiration, issued-at time, nonce, subject, and `azp` when needed.
6. Read the actual granted `scope`. Only a response containing `chatgpt.tokens.use.direct` enables a bearer `GET https://api.openai.com/v1/models`; a successful catalog response is the provider-access proof.

The protocol details come from the [OpenAI Sign in with ChatGPT guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in) and [Sign in with ChatGPT cookbook](https://developers.openai.com/cookbook/articles/sign-in-with-chatgpt). The provider's Node/Electron example is not treated as proof that the flow works on iOS.

## iOS harness

Open `packages/provider-openai/ios-spike/ChatGPTOAuthSpike.xcodeproj` and run the `ChatGPTOAuthSpike` target in an iOS Simulator. The app binds its one-shot `NWListener` to `127.0.0.1`, opens the external browser with `UIApplication.open`, and displays scene-phase transitions while the browser is active. On the callback page, return to the app to continue validation. The app displays only the final scope result and model catalog; it does not display or log the authorization code, access token, ID token, or account identifiers.

The harness UI copy stays in Korean regardless of the Simulator's preferred language; OAuth parameters and provider scope identifiers retain their protocol spellings.

The lifecycle display is evidence to collect, not a guarantee of background execution. iOS can suspend an app after the browser handoff. Record whether Safari reached the loopback page, whether the listener responded before and after returning to Orot, and the observed `active`, `inactive`, and `background` transitions. A listener callback received after the app resumes does not prove the process was continuously running in the background.

Use a human-operated ChatGPT login and consent only after the Simulator is showing the provider screen. Do not save screenshots, logs, or reports containing callback URLs, codes, tokens, email addresses, or other account data. Record the Simulator device and OS, the callback/lifecycle outcome, whether the direct-plan scope was returned, and whether `/v1/models` returned HTTP 200. If permission is denied, the app stops before requesting the catalog.

## Local verification

Run the focused package tests:

```sh
swift test --package-path packages/provider-openai
```

Build the independent Simulator harness without changing the app project:

```sh
xcodebuild \
  -project packages/provider-openai/ios-spike/ChatGPTOAuthSpike.xcodeproj \
  -scheme ChatGPTOAuthSpike \
  -configuration Debug \
  -destination 'generic/platform=iOS Simulator' \
  CODE_SIGNING_ALLOWED=NO \
  build
```

CI runs both commands in the existing `iOS Simulator Build` check and retains their logs with that check's artifacts. A passing build verifies package/harness compatibility; it does not verify browser handoff, background behavior, user consent, the granted provider scope, or live provider access.

## Boundaries

- Only the host identifier is persisted. OAuth calls use an ephemeral URL session with cookies and cache disabled; access and ID tokens remain in memory for the one run. There is no refresh/reconnect or Keychain work.
- The harness makes a live model-catalog request only after verified identity and an actually granted direct-plan scope.
- Package tests use a public test-only JWK and signed fixture variants. They do not contact OpenAI.
- This spike is not production React Native integration and does not promise that the loopback flow survives iOS suspension.

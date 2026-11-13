# Voice conversation integration contract

The source connects on-device Apple Speech recognition, the conversation's selected text provider, and system speech synthesis. Apple documents [live audio buffer recognition](https://developer.apple.com/documentation/speech/sfspeechaudiobufferrecognitionrequest), [on-device recognition requirements](https://developer.apple.com/documentation/speech/sfspeechrecognitionrequest/requiresondevicerecognition), and [speech synthesis](https://developer.apple.com/documentation/avfaudio/avspeechsynthesizer). The recognizer must report on-device support and the request must require it; otherwise capture fails. Source integration does not prove the pipeline runs successfully.

The native adapter must acquire microphone and speech permissions after explicit activation, keep audio ephemeral, end recognition and stop capture, and stop synthesis on stop, interruption, route loss or backgrounding. It must fence resource acquisition with the provided abort signal, identify handles by turn, make cleanup idempotent, and report release failures. It must not create consultation recordings or files. Native permissions, audio-session arbitration, routes and audible output require native validation.

The application owner must generate never-reused turn identities, bind the current session and selected provider, and revalidate provider transmission consent immediately before sending. The submit port must use the existing session-owned request and retention path, provide request-specific cancellation rather than cancelling an unrelated request, and return only the completed committed answer. Native callbacks and state notifications must retain the original identity. Provider change, session deletion, consent withdrawal and interruption must stop the owner. The controller requires every asynchronous port to settle after abort; until it does, the cleaning state prevents a new turn.

Voice input does not consume the text draft or staged photos. The caller reports a staged or pending photo so the voice turn refuses submission rather than silently omitting or transmitting it. A future combined photo turn must use the existing attachment preparation and consent contract. Text fallback remains available. The source registers the native bridge and connects the shared audio owner and request-specific completion. Native build, actual permissions and audio-session behavior, VoiceOver and layout, and real-provider response and voice quality remain unverified and require the allocated integration checks.

## Focused native lifecycle observation

`OrotIntegrationTests/VoiceConversationLifecycleTests/testSystemSpeechCompletionAndStopReleasePlayback` is an explicitly selected acceptance diagnostic. It calls the production speech adapter with synthetic Korean text at zero volume, observes actual system synthesis completion, explicitly stops a second utterance, and verifies that the shared audio lease can be released and acquired again. Default production volume remains one. Registration or compilation does not establish a runtime pass; record the exact revision, allocated Simulator, command and result before using this evidence.

This observation never opens a microphone, requests permissions, or calls a model provider. It does not establish audible output quality or microphone start/stop. The current capture adapter reads the real `AVAudioEngine.inputNode`; it has no verified synthetic-input routing contract. Do not authorize a host microphone or capture ambient user audio just to complete acceptance. Capture remains unverified until an isolated synthetic-input route is established, or the owner explicitly authorizes a specific live-input test. On-device recognition and the selected provider's real response remain separate evidence boundaries.

## Continuous-session foundation (not full-duplex completion)

Explicit consent now opens a full-screen voice surface. End and mute cancel the owned operation;
resume reuses the same approved session/provider, with point-of-use revalidation. A completed
reply releases its audio lease before a fresh turn begins. Queued continuation is invalidated
by end, mute, interruption or route/selection invalidation. Partial on-device transcripts that
remain unchanged for 1.2 seconds request end-of-audio; manual completion remains a fallback.
This is transcript endpointing, not an acoustic voice-activity detector.

The current pipeline still waits for the selected text provider's complete answer and uses
local synthesis. The explicit interrupt control cancels processing/playback before listening;
it is not spoken barge-in while playback continues. True simultaneous microphone/playback
needs a supported duplex audio-session/echo-cancellation contract and native evidence. External
realtime audio would change transmitted data and possibly model/cost/consent, and is not selected
or authorized by this foundation. Keep #741 open until its full requirements are met.

The full-screen surface has not yet received native geometry/accessibility or live-input
validation. The 2d978816 safety test's silent synthesis pass does not establish these new paths.

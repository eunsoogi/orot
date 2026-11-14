import Foundation

/// Server events cannot reactivate capture or playback while the call is muted.
extension RealtimeVoiceCall {
    func receive(_ event: [String: Any]) {
        guard id != nil, let type = event["type"] as? String else { return }
        switch type {
        case "session.updated": if !paused {
                beginAudio()
            }
        case "error": fail()
        case "input_audio_buffer.speech_started": if !paused {
                interrupt(cancel: false); state("listening")
            }
        case "input_audio_buffer.speech_stopped": if !paused {
                state("processing")
            }
        case "input_audio_buffer.cleared": awaitingClear = false
        case "input_audio_buffer.committed": if !paused, !awaitingClear {
                awaitingInputCommit = false
            }
        case "response.created":
            response = (event["response"] as? [String: Any])?["id"] as? String
            if awaitingInputCommit || paused {
                interrupt()
            }
        case "response.output_audio.delta":
            guard !paused, let responseId = event["response_id"] as? String, responseId == response, !ignoredResponses.contains(responseId),
                  let next = event["item_id"] as? String, let encoded = event["delta"] as? String,
                  let data = Data(base64Encoded: encoded) else { return }
            if item != next {
                _ = audio.cancel(); item = next
            }
            contentIndex = event["content_index"] as? Int ?? 0
            do { try audio.append(data); state("speaking") } catch { fail() }
        case "conversation.item.input_audio_transcription.completed": transcript(event, role: "user")
        case "response.output_audio_transcript.done":
            if let responseId = event["response_id"] as? String, !ignoredResponses.contains(responseId) {
                transcript(event, role: "assistant")
            }
        case "response.done":
            let result = event["response"] as? [String: Any]
            if result?["status"] as? String == "failed" {
                fail(); return
            }
            if result?["id"] as? String == response {
                response = nil
                if audio.isDrained, !paused {
                    state("listening")
                }
            }
        default: break
        }
    }

    func transcript(_ event: [String: Any], role: String) {
        guard !paused, let id, let text = event["transcript"] as? String, let itemId = event["item_id"] as? String else { return }
        emit("VoiceRealtimeTranscript", ["callId": id, "role": role, "text": text, "itemId": itemId])
    }

    func interrupt(cancel: Bool = true) {
        guard id != nil else { return }
        awaitingInputCommit = true
        if let response {
            ignoredResponses.insert(response)
            if ignoredResponses.count > 256 {
                fail(); return
            }
            if cancel {
                socket.send(["type": "response.cancel", "response_id": response])
            }
            self.response = nil
        }
        let milliseconds = audio.cancel()
        if let item {
            socket.send(["type": "conversation.item.truncate", "item_id": item, "content_index": contentIndex, "audio_end_ms": milliseconds])
        }
        item = nil
        if !paused {
            state("listening")
        }
    }
}

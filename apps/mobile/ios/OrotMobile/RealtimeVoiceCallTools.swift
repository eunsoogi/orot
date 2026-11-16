import Foundation

/// Native transports only identifiers and a separately approved JS reply. It never reads
/// health stores or interprets model arguments as a delegated action or user authorization.
extension RealtimeVoiceCall {
    func cancelTools(keepInput: Bool = false) {
        if let tool = tools.invalidate(keepInput: keepInput), let id {
            emit("VoiceRealtimeToolCancelled", ["callId": id, "toolCallId": tool])
        }
    }

    func receiveTool(_ event: [String: Any]) {
        guard !paused, ready, let responseID = event["response_id"] as? String,
              responseID == response, !ignoredResponses.contains(responseID),
              let toolCallID = event["call_id"] as? String, let name = event["name"] as? String,
              let arguments = event["arguments"] as? String else { return }
        tools.receive(responseID: responseID, toolCallID: toolCallID, name: name, arguments: arguments)
    }

    func completeTools(_ result: [String: Any]?) {
        guard let result, let responseID = result["id"] as? String else { return }
        let successful = result["status"] as? String == "completed" && !paused && ready
        guard let request = tools.complete(responseID, successful: successful), let id else { return }
        emit("VoiceRealtimeToolCall", ["callId": id, "responseId": request.responseID,
                                       "toolCallId": request.toolCallID, "inputItemId": request.inputItemID])
    }

    /// A reply is one-shot and cannot cross a speech, response, mute, stop, or disposal boundary.
    /// This method is not a consent mechanism: the JS caller must approve the exact output first.
    func resolveTool(_ identifier: String, toolCallID: String, responseID: String, output: String) -> Bool {
        guard id == identifier, !paused, ready, token != nil else { return false }
        guard foreground() else { cancelTools(); return false }
        guard output.utf8.count <= 16384,
              tools.consume(toolCallID: toolCallID, responseID: responseID) else { return false }
        socket.send(["type": "conversation.item.create", "item": ["type": "function_call_output", "call_id": toolCallID, "output": output]])
        socket.send(["type": "response.create"])
        return true
    }
}

import Foundation

struct ResponsesEventNormalizer {
    let requestID: String?
    private(set) var accumulatedText = ""
    private(set) var completed = false

    mutating func consume(_ frame: ResponsesSSEFrame) throws -> ChatGPTResponsesEvent? {
        guard !completed else { return nil }
        if frame.data == "[DONE]" { return nil }
        guard let data = frame.data.data(using: .utf8),
              let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let type = object["type"] as? String ?? frame.event else {
            throw ChatGPTResponsesError.malformedEvent
        }
        if let frameEvent = frame.event, frameEvent != type {
            throw ChatGPTResponsesError.malformedEvent
        }

        switch type {
        case "response.output_text.delta", "response.refusal.delta":
            guard let delta = object["delta"] as? String else { throw ChatGPTResponsesError.malformedEvent }
            accumulatedText.append(delta)
            return delta.isEmpty ? nil : .textDelta(delta)
        case "response.completed":
            guard let response = object["response"] as? [String: Any],
                  response["status"] as? String == "completed" else {
                throw ChatGPTResponsesError.malformedEvent
            }
            let finalText = try Self.responseText(response, fallback: accumulatedText)
            guard finalText == accumulatedText else { throw ChatGPTResponsesError.malformedEvent }
            completed = true
            return .completed(ChatGPTResponsesResult(text: finalText))
        case "response.incomplete":
            let response = object["response"] as? [String: Any]
            let details = response?["incomplete_details"] as? [String: Any]
            throw ChatGPTResponsesError.incomplete(
                ChatGPTResponsesDiagnostics(requestID: requestID, reason: details?["reason"] as? String)
            )
        case "response.failed", "error":
            let response = object["response"] as? [String: Any]
            let error = (response?["error"] as? [String: Any]) ?? (object["error"] as? [String: Any])
            throw ChatGPTResponsesError.responseFailure(
                ChatGPTResponsesDiagnostics(
                    bodyShape: error == nil ? "error_event" : "error_object",
                    code: error?["code"] as? String,
                    parameter: error?["param"] as? String,
                    requestID: requestID
                )
            )
        default:
            return nil
        }
    }

    private static func responseText(_ response: [String: Any], fallback: String) throws -> String {
        if let outputText = response["output_text"] as? String { return outputText }
        guard let output = response["output"] as? [[String: Any]] else { return fallback }

        var parts = [String]()
        for item in output {
            guard let content = item["content"] as? [[String: Any]] else { continue }
            for part in content {
                if part["type"] as? String == "output_text", let text = part["text"] as? String {
                    parts.append(text)
                } else if part["type"] as? String == "refusal", let refusal = part["refusal"] as? String {
                    parts.append(refusal)
                }
            }
        }
        return parts.joined()
    }
}

import Foundation

/// Public-search citations annotate message content, so that exact content must
/// determine returned text. A top-level convenience field cannot substitute a
/// different answer. Ordinary private responses retain their existing fallback policy.
enum ResponsesOutputText {
    static func resolve(
        _ response: [String: Any],
        fallback: String,
        publicWebSearch: Bool,
    ) throws -> String {
        if !publicWebSearch, let outputText = response["output_text"] as? String {
            return outputText
        }
        guard let output = response["output"] as? [[String: Any]] else {
            if publicWebSearch {
                throw ChatGPTResponsesError.malformedEvent
            }
            return fallback
        }
        var parts = [String]()
        for item in output where !publicWebSearch || item["type"] as? String == "message" {
            guard let content = item["content"] as? [[String: Any]] else { continue }
            for part in content {
                if part["type"] as? String == "output_text", let text = part["text"] as? String {
                    parts.append(text)
                } else if part["type"] as? String == "refusal", let refusal = part["refusal"] as? String {
                    parts.append(refusal)
                }
            }
        }
        let text = parts.joined()
        if publicWebSearch, let declared = response["output_text"] {
            guard let declaredText = declared as? String, declaredText == text else {
                throw ChatGPTResponsesError.malformedEvent
            }
        }
        return text
    }
}

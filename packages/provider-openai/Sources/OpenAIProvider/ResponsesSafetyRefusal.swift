import Foundation

/// Refusal is a terminal policy outcome, not text, a malformed result, or an
/// unavailable optional search. Inspect only protocol markers, never prose.
enum ResponsesSafetyRefusal {
    static func validate(_ object: [String: Any], type: String) throws {
        if type == "response.refusal.delta" || type == "response.refusal.done" {
            throw refusal()
        }
        if let part = object["part"] as? [String: Any], part["type"] as? String == "refusal" {
            throw refusal()
        }
        if let item = object["item"] as? [String: Any] {
            try validateOutput([item])
        }
        if let response = object["response"] as? [String: Any] {
            if let details = response["incomplete_details"] as? [String: Any],
               details["reason"] as? String == "content_filter"
            {
                throw refusal()
            }
            if let output = response["output"] as? [[String: Any]] {
                try validateOutput(output)
            }
        }
    }

    static func validateOutput(_ output: [[String: Any]]) throws {
        for item in output {
            if item["type"] as? String == "refusal" {
                throw refusal()
            }
            if let content = item["content"] as? [[String: Any]],
               content.contains(where: { $0["type"] as? String == "refusal" })
            {
                throw refusal()
            }
        }
    }

    private static func refusal() -> ChatGPTResponsesError {
        .responseFailure(ChatGPTResponsesDiagnostics(code: "safety_refusal"))
    }
}

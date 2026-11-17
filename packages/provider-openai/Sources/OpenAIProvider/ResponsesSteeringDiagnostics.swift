import Foundation

/// Normal diagnostics reduce wire values to closed enums before formatting.
/// A separate local-only opt-in may emit the bounded protocol type, never the object.
enum ResponsesSteeringDiagnostics {
    enum Code: String, CaseIterable {
        case invalidRequest = "invalid_request"
        case invalidRequestError = "invalid_request_error"
        case usageLimit = "subscription_sharing_usage_limit_exceeded"
        case usageUnavailable = "subscription_sharing_usage_unavailable"
        case userUnavailable = "subscription_sharing_user_unavailable"
        case unsupported = "subscription_sharing_unsupported_capability"
        case invalidUser = "subscription_sharing_invalid_user"
        case scope = "chatpass_v2_scope_not_authorized"
        case authorization = "chatpass_v2_invalid_authorization_context"
        case other
    }

    /// Same exact parameter allowlist as the native provider diagnostic sink.
    enum Parameter: String, CaseIterable {
        case model, temperature, tools, input, store, other
        case maxOutputTokens = "max_output_tokens"
        case toolChoice = "tool_choice"
        case parallelToolCalls = "parallel_tool_calls"
        case textFormat = "text.format"
    }

    static func errorMessage(_ object: [String: Any], enabled: Bool) -> String? {
        guard enabled else { return nil }
        let error = object["error"] as? [String: Any] ?? [:]
        let code = Code(rawValue: error["code"] as? String ?? "") ?? .other
        let parameter = Parameter(rawValue: error["param"] as? String ?? "") ?? .other
        return "OROT_PROVIDER_DIAGNOSTIC provider=openai stage=steering_error code=\(code.rawValue) parameter=\(parameter.rawValue)"
    }

    static func beforeActiveFailure(_ object: [String: Any], type: String) -> ChatGPTResponsesError {
        if let message = ResponsesBeforeActiveDiagnostics.message(
            type: type,
            enabled: ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS"),
        ) {
            NSLog("%@", message)
        }
        if let message = ResponsesBeforeActiveDiagnostics.protocolMessage(
            type: type,
            enabled: ProcessInfo.processInfo.arguments.contains("-OROT_PROTOCOL_TYPE_DIAGNOSTICS"),
        ) {
            NSLog("%@", message)
        }
        let category: ResponsesMalformedDiagnostics.Category
        switch type {
        case "error":
            category = .steeringNoActiveError
            if let message = errorMessage(
                object,
                enabled: ProcessInfo.processInfo.arguments.contains("-OROT_PROVIDER_DIAGNOSTICS"),
            ) {
                NSLog("%@", message)
            }
        case "response.failed": category = .steeringNoActiveFailed
        default: category = .steeringNoActive
        }
        // Preserve the original rejection: this instrumentation must not replay or recover.
        return ResponsesMalformedDiagnostics.failure(category)
    }
}

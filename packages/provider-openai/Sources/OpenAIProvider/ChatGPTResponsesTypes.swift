import Foundation

public enum ChatGPTResponsesMessage: Equatable, Sendable {
    case system(String)
    case user(String)
    case assistant(String)
}

public struct ChatGPTResponsesRequest: Equatable, Sendable {
    public let model: String
    public let messages: [ChatGPTResponsesMessage]

    public init(model: String, messages: [ChatGPTResponsesMessage]) {
        self.model = model
        self.messages = messages
    }
}

public struct ChatGPTResponsesResult: Equatable, Sendable {
    public let text: String

    public init(text: String) {
        self.text = text
    }
}

public enum ChatGPTResponsesEvent: Equatable, Sendable {
    case textDelta(String)
    case completed(ChatGPTResponsesResult)
}

public struct ChatGPTResponsesDiagnostics: Equatable, Sendable {
    public let httpStatusCode: Int?
    public let bodyShape: String?
    public let bodyTruncated: Bool
    public let code: String?
    public let parameter: String?
    public let requestID: String?
    public let reason: String?

    public init(
        httpStatusCode: Int? = nil,
        bodyShape: String? = nil,
        bodyTruncated: Bool = false,
        code: String? = nil,
        parameter: String? = nil,
        requestID: String? = nil,
        reason: String? = nil,
    ) {
        self.httpStatusCode = httpStatusCode
        self.bodyShape = bodyShape
        self.bodyTruncated = bodyTruncated
        self.code = code
        self.parameter = parameter
        self.requestID = requestID
        self.reason = reason
    }
}

public enum ChatGPTResponsesError: Error, Equatable, LocalizedError, Sendable {
    case invalidRequest
    case unsupportedCapability(String)
    case unsupportedInput(String)
    case transportUnavailable
    case invalidHTTPResponse
    case invalidContentType
    case httpFailure(ChatGPTResponsesDiagnostics)
    case responseFailure(ChatGPTResponsesDiagnostics)
    case incomplete(ChatGPTResponsesDiagnostics)
    case interrupted
    case malformedEvent

    public var errorDescription: String? {
        switch self {
        case .invalidRequest: "The ChatGPT Responses request is invalid."
        case let .unsupportedCapability(capability): "The ChatGPT plan route does not support \(capability)."
        case let .unsupportedInput(input): "The ChatGPT plan route does not support \(input) input."
        case .transportUnavailable: "ChatGPT inference could not connect to the Responses API."
        case .invalidHTTPResponse: "ChatGPT returned an invalid HTTP response."
        case .invalidContentType: "ChatGPT returned a non-event-stream Responses body."
        case let .httpFailure(diagnostics): Self.message(for: diagnostics)
        case let .responseFailure(diagnostics): Self.message(for: diagnostics)
        case let .incomplete(diagnostics): Self.message(for: diagnostics)
        case .interrupted: "ChatGPT inference ended before a completed response."
        case .malformedEvent: "ChatGPT returned an invalid Responses stream event."
        }
    }

    private static func message(for diagnostics: ChatGPTResponsesDiagnostics) -> String {
        switch diagnostics.code {
        case "subscription_sharing_usage_limit_exceeded": return "The ChatGPT plan usage limit was reached."
        case "subscription_sharing_usage_unavailable", "subscription_sharing_user_unavailable":
            return "ChatGPT plan usage is temporarily unavailable."
        case "subscription_sharing_unsupported_capability":
            return "This request uses a capability unavailable on the ChatGPT plan route."
        case "subscription_sharing_invalid_user", "chatpass_v2_scope_not_authorized",
             "chatpass_v2_invalid_authorization_context":
            return "The selected ChatGPT account did not authorize this request."
        default:
            if diagnostics.httpStatusCode == 401 {
                return "The selected ChatGPT account must be authorized again."
            }
            if diagnostics.httpStatusCode == 429 {
                return "The ChatGPT plan usage limit was reached."
            }
            return "ChatGPT could not complete the Responses request."
        }
    }
}

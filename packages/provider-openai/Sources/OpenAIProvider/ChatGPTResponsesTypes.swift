import Foundation
import CoreFoundation

public enum ChatGPTResponsesMessage: Equatable, Sendable {
    case system(String)
    case user(String)
    case assistant(String)
    case functionCall(callID: String, name: String, argumentsJSON: String)
    case functionCallOutput(callID: String, output: String)
    case continuationItem(json: String)
}

public struct ChatGPTResponsesToolDefinition: Equatable, Sendable {
    public let name: String
    public let description: String?
    public let parametersJSON: String
    public let strict: Bool

    public init(name: String, description: String? = nil, parametersJSON: String, strict: Bool = false) {
        self.name = name
        self.description = description
        self.parametersJSON = parametersJSON
        self.strict = strict
    }
}

public struct ChatGPTResponsesFunctionCall: Equatable, Sendable {
    public let id: String
    public let name: String
    public let argumentsJSON: String

    public init(id: String, name: String, argumentsJSON: String) {
        self.id = id
        self.name = name
        self.argumentsJSON = argumentsJSON
    }
}

public struct ChatGPTResponsesRequest: Equatable, Sendable {
    public let model: String
    public let messages: [ChatGPTResponsesMessage]
    public let tools: [ChatGPTResponsesToolDefinition]
    public let toolChoice: String?
    public let publicWebQuery: String?

    public init(
        model: String,
        messages: [ChatGPTResponsesMessage],
        tools: [ChatGPTResponsesToolDefinition] = [],
        toolChoice: String? = nil,
        publicWebQuery: String? = nil,
    ) {
        self.model = model
        self.messages = messages
        self.tools = tools
        self.toolChoice = toolChoice
        self.publicWebQuery = publicWebQuery
    }
}

/// Counts are copied from terminal provider usage, never from local tokenization or text length.
public struct ChatGPTResponsesUsage: Equatable, Sendable {
    public let inputTokens: Int
    public let outputTokens: Int
    public let totalTokens: Int

    public init(inputTokens: Int, outputTokens: Int, totalTokens: Int) {
        self.inputTokens = inputTokens
        self.outputTokens = outputTokens
        self.totalTokens = totalTokens
    }

    /// The React Native bridge admits only the closed numeric shape, not provider diagnostics.
    public var nativePayload: [String: Int] {
        ["inputTokens": inputTokens, "outputTokens": outputTokens, "totalTokens": totalTokens]
    }

    static func decode(_ value: Any?) throws -> Self? {
        guard let value, !(value is NSNull) else { return nil }
        guard let object = value as? [String: Any] else { throw ChatGPTResponsesError.malformedEvent }
        return try Self(
            inputTokens: count(object["input_tokens"]),
            outputTokens: count(object["output_tokens"]),
            totalTokens: count(object["total_tokens"]),
        )
    }

    private static func count(_ value: Any?) throws -> Int {
        // JSON booleans also bridge as NSNumber. Reject them and anything unsafe in JavaScript.
        guard let number = value as? NSNumber, CFGetTypeID(number) != CFBooleanGetTypeID() else {
            throw ChatGPTResponsesError.malformedEvent
        }
        let count = number.doubleValue
        guard count.isFinite, count >= 0, count <= 9007199254740991, count.rounded() == count else {
            throw ChatGPTResponsesError.malformedEvent
        }
        return Int(count)
    }
}

public struct ChatGPTResponsesResult: Equatable, Sendable {
    public let text: String
    public let toolCalls: [ChatGPTResponsesFunctionCall]
    public let continuationItems: [String]
    public let webSearch: ChatGPTPublicWebSearchResult?
    public let usage: ChatGPTResponsesUsage?

    public init(
        text: String,
        toolCalls: [ChatGPTResponsesFunctionCall] = [],
        continuationItems: [String] = [],
        webSearch: ChatGPTPublicWebSearchResult? = nil,
        usage: ChatGPTResponsesUsage? = nil,
    ) {
        self.text = text
        self.toolCalls = toolCalls
        self.continuationItems = continuationItems
        self.webSearch = webSearch
        self.usage = usage
    }
}

public enum ChatGPTResponsesEvent: Equatable, Sendable {
    case textDelta(String)
    case toolCall(ChatGPTResponsesFunctionCall)
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

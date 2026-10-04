import Foundation
import OpenAIProvider

/// Keep the bridge's public error shape independent from request lifecycle handling.
enum OpenAIProviderErrorDetails {
    static func make(_ error: Error) -> [String: Any] {
        var result: [String: Any] = ["kind": "provider", "message": error.localizedDescription]
        if let error = error as? ChatGPTResponsesError {
            switch error {
            case .unsupportedCapability: result["kind"] = "unsupported_capability"
            case .unsupportedInput: result["kind"] = "unsupported_input"
            case .transportUnavailable: result["kind"] = "transport"
            case .invalidRequest: result["kind"] = "invalid_request"
            case let .incomplete(details): result["kind"] = "incomplete"; Self.add(details, to: &result)
            case .interrupted: result["kind"] = "interrupted"
            case let .httpFailure(details), let .responseFailure(details): add(details, to: &result)
            case .invalidHTTPResponse, .invalidContentType, .malformedEvent: break
            }
        } else if let error = error as? ChatGPTOAuthError {
            switch error {
            case .planPermissionMissing, .accountNotFound, .reauthorizationRequired, .accountIdentityMismatch:
                result["kind"] = "authentication"
            case let .modelCatalogHTTPFailure(details): add(details, to: &result)
            default: break
            }
        }
        let status = result["httpStatusCode"] as? Int
        let providerCode = result["code"] as? String
        if providerCode == "subscription_sharing_usage_limit_exceeded" || status == 429 {
            result["kind"] = "usage_limit"
            result["code"] = providerCode ?? "rate_limited"
        } else if providerCode == "subscription_sharing_unsupported_capability" {
            result["kind"] = "unsupported_capability"
        } else if providerCode == "subscription_sharing_usage_unavailable" || providerCode == "subscription_sharing_user_unavailable" {
            result["kind"] = "usage_unavailable"
        } else if status == 401 || status == 403 {
            result["kind"] = "authentication"
        } else if status == 400 {
            result["kind"] = "invalid_request"
        }
        if result["code"] == nil {
            result["code"] = result["kind"]
        }
        return result
    }

    private static func add(_ details: ChatGPTResponsesDiagnostics, to result: inout [String: Any]) {
        if let httpStatusCode = details.httpStatusCode {
            result["httpStatusCode"] = httpStatusCode
        }
        if let bodyShape = details.bodyShape {
            result["bodyShape"] = bodyShape
        }
        if let code = details.code {
            result["code"] = code
        }
        if let parameter = details.parameter {
            result["parameter"] = parameter
        }
        if let requestID = details.requestID {
            result["requestID"] = requestID
        }
        if let reason = details.reason {
            result["reason"] = reason
        }
        result["bodyTruncated"] = details.bodyTruncated
    }
}

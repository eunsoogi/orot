import Foundation

struct OAuthCallback: Equatable, Sendable {
    let code: String
    let issuedClientID: String
}

enum OAuthCallbackParser {
    static func parse(
        _ callbackURL: URL,
        expectedState: String,
        expectedRedirectURI: URL,
        expectedClientID: String? = nil
    ) throws -> OAuthCallback {
        guard isCallbackAddress(callbackURL, expectedRedirectURI: expectedRedirectURI),
              let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false),
              let encodedQuery = components.percentEncodedQuery else {
            throw ChatGPTOAuthError.invalidCallback
        }
        var formComponents = URLComponents()
        formComponents.percentEncodedQuery = encodedQuery.replacingOccurrences(of: "+", with: "%20")
        guard let queryItems = formComponents.queryItems else { throw ChatGPTOAuthError.invalidCallback }

        let values = try uniqueValues(queryItems)
        guard values["state"] == expectedState else { throw ChatGPTOAuthError.stateMismatch }

        if let error = values["error"] {
            if error == "access_denied" { throw ChatGPTOAuthError.accessDenied }
            throw ChatGPTOAuthError.providerFailure
        }

        guard let code = values["code"], !code.isEmpty else {
            throw ChatGPTOAuthError.invalidCallback
        }
        let clientID: String
        if let expectedClientID, expectedClientID != ChatGPTOAuthConstants.initialClientID {
            if let callbackClientID = values["client_id"], callbackClientID != expectedClientID {
                throw ChatGPTOAuthError.registrationMismatch
            }
            clientID = expectedClientID
        } else {
            guard let issuedClientID = values["client_id"],
                  KeychainChatGPTCredentialStore.isValidIssuedClientID(issuedClientID) else {
                throw ChatGPTOAuthError.registrationIncomplete
            }
            clientID = issuedClientID
        }

        return OAuthCallback(code: code, issuedClientID: clientID)
    }

    private static func isCallbackAddress(_ url: URL, expectedRedirectURI: URL) -> Bool {
        url.scheme == "http"
            && url.host == "127.0.0.1"
            && url.path == ChatGPTOAuthConstants.callbackPath
            && url.port == expectedRedirectURI.port
            && url.user == nil
            && url.password == nil
            && url.fragment == nil
    }

    private static func uniqueValues(_ items: [URLQueryItem]) throws -> [String: String] {
        var values: [String: String] = [:]
        var seen = Set<String>()
        for item in items {
            guard seen.insert(item.name).inserted, let value = item.value else {
                throw ChatGPTOAuthError.invalidCallback
            }
            values[item.name] = value
        }
        return values
    }
}

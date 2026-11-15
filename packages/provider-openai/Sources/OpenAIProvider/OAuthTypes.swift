import Foundation

public enum ChatGPTOAuthError: Error, Equatable, LocalizedError, Sendable {
    case invalidHostIdentifier
    case invalidAuthorizationRequest
    case invalidRedirectURI
    case discoveryUnavailable
    case invalidCallback
    case stateMismatch
    case registrationIncomplete
    case registrationMismatch
    case accessDenied
    case providerFailure
    case invalidTokenResponse
    case invalidIdentity
    case accountIdentityMismatch
    case planPermissionMissing
    case modelCatalogUnavailable
    case modelCatalogHTTPFailure(ChatGPTResponsesDiagnostics)
    case credentialStoreUnavailable
    case accountNotFound
    case reauthorizationRequired
    case sessionSigningOut

    public var errorDescription: String? {
        switch self {
        case .invalidHostIdentifier: return ProviderDisplayCopy.text("invalidHostIdentifier")
        case .invalidAuthorizationRequest: return ProviderDisplayCopy.text("invalidAuthorizationRequest")
        case .invalidRedirectURI: return ProviderDisplayCopy.text("invalidRedirectURI")
        case .discoveryUnavailable: return ProviderDisplayCopy.text("discoveryUnavailable")
        case .invalidCallback: return ProviderDisplayCopy.text("invalidCallback")
        case .stateMismatch: return ProviderDisplayCopy.text("stateMismatch")
        case .registrationIncomplete: return ProviderDisplayCopy.text("registrationIncomplete")
        case .registrationMismatch: return ProviderDisplayCopy.text("registrationMismatch")
        case .accessDenied: return ProviderDisplayCopy.text("accessDenied")
        case .providerFailure: return ProviderDisplayCopy.text("providerFailure")
        case .invalidTokenResponse: return ProviderDisplayCopy.text("invalidTokenResponse")
        case .invalidIdentity: return ProviderDisplayCopy.text("invalidIdentity")
        case .accountIdentityMismatch: return ProviderDisplayCopy.text("accountIdentityMismatch")
        case .planPermissionMissing: return ProviderDisplayCopy.text("planPermissionMissing")
        case .modelCatalogUnavailable: return ProviderDisplayCopy.text("modelCatalogUnavailable")
        case let .modelCatalogHTTPFailure(diagnostics):
            if diagnostics.httpStatusCode == 401 {
                return ProviderDisplayCopy.text("modelReauthentication")
            }
            if diagnostics.httpStatusCode == 429 {
                return ProviderDisplayCopy.text("modelLimit")
            }
            return ProviderDisplayCopy.text("modelHTTPFailure")
                .replacingOccurrences(of: "{status}", with: String(diagnostics.httpStatusCode ?? 0))
        case .credentialStoreUnavailable: return ProviderDisplayCopy.text("credentialStoreUnavailable")
        case .accountNotFound: return ProviderDisplayCopy.text("accountNotFound")
        case .reauthorizationRequired: return ProviderDisplayCopy.text("reauthorizationRequired")
        case .sessionSigningOut: return ProviderDisplayCopy.text("sessionSigningOut")
        }
    }
}

public struct ListedChatGPTModel: Equatable, Sendable {
    public let slug: String
    public let displayName: String

    public init(slug: String, displayName: String) {
        self.slug = slug
        self.displayName = displayName
    }
}

public struct ChatGPTAccountAccess: Sendable {
    public let issuedClientID: String
    public let subject: String
    public let grantedScopes: Set<String>

    let accessToken: String

    public var hasDirectPlanAccess: Bool {
        grantedScopes.contains(ChatGPTOAuthConstants.directPlanScope)
    }
}

public enum ChatGPTOAuthConstants {
    public static let issuer = "https://auth.openai.com"
    public static let initialClientID = "dynamic_agent_client"
    public static let resource = "https://api.openai.com/v1"
    public static let directPlanScope = "chatgpt.tokens.use.direct"
    public static let scopes = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
    public static let callbackPath = "/auth/callback"
    /// Contains no OAuth result; the active authentication session uses it only to resume Orot.
    public static let appReturnURL = URL(string: "orot://oauth/complete")!

    /// Rejects any result data or URL components outside the fixed system-session callback.
    public static func isValidAppReturnURL(_ url: URL) -> Bool {
        url.scheme == appReturnURL.scheme
            && url.host == appReturnURL.host
            && url.path == appReturnURL.path
            && url.query == nil
            && url.fragment == nil
            && url.user == nil
            && url.password == nil
            && url.port == nil
    }
}

struct OpenIDConfiguration: Decodable, Sendable {
    let issuer: String
    let authorizationEndpoint: URL
    let tokenEndpoint: URL
    let jwksURI: URL
    let revocationEndpoint: URL

    enum CodingKeys: String, CodingKey {
        case issuer
        case authorizationEndpoint = "authorization_endpoint"
        case tokenEndpoint = "token_endpoint"
        case jwksURI = "jwks_uri"
        case revocationEndpoint = "revocation_endpoint"
    }
}

public struct PendingChatGPTAuthorization: Sendable {
    public let authorizationURL: URL
    public let redirectURI: URL
    let hostIdentifier: String
    let requestedClientID: String
    let expectedSubject: String?
    let idTokenHint: String?

    let state: String
    let nonce: String
    let codeVerifier: String
    let discovery: OpenIDConfiguration
    let authorizationGeneration: UInt64
}

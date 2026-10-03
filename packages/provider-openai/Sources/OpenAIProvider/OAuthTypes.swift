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
    case credentialStoreUnavailable
    case accountNotFound
    case reauthorizationRequired
    case sessionSigningOut

    public var errorDescription: String? {
        switch self {
        case .invalidHostIdentifier: "기기 식별자 형식이 올바르지 않습니다."
        case .invalidAuthorizationRequest: "로그인 요청을 준비하지 못했습니다."
        case .invalidRedirectURI: "127.0.0.1 콜백 주소가 올바르지 않습니다."
        case .discoveryUnavailable: "ChatGPT 로그인 설정을 불러오지 못했습니다."
        case .invalidCallback: "로그인 콜백 응답이 올바르지 않습니다."
        case .stateMismatch: "로그인 응답이 현재 로그인 시도와 일치하지 않습니다."
        case .registrationIncomplete: "ChatGPT 동적 클라이언트 등록이 완료되지 않았습니다."
        case .registrationMismatch: "등록된 클라이언트가 요청과 일치하지 않습니다."
        case .accessDenied: "ChatGPT 권한 요청이 거부되었습니다."
        case .providerFailure: "ChatGPT 로그인을 완료하지 못했습니다."
        case .invalidTokenResponse: "ChatGPT가 올바르지 않은 토큰 응답을 보냈습니다."
        case .invalidIdentity: "ChatGPT ID 토큰 검증에 실패했습니다."
        case .accountIdentityMismatch: "선택한 ChatGPT 계정과 로그인 응답이 일치하지 않습니다."
        case .planPermissionMissing: "chatgpt.tokens.use.direct 권한이 허용되지 않았습니다."
        case .modelCatalogUnavailable: "/v1/models 목록을 가져오지 못했습니다."
        case .credentialStoreUnavailable: "보호된 로그인 정보를 저장하거나 불러오지 못했습니다."
        case .accountNotFound: "저장된 ChatGPT 계정을 찾지 못했습니다."
        case .reauthorizationRequired: "ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요."
        case .sessionSigningOut: "ChatGPT 로그아웃이 진행 중입니다."
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

    init(
        authorizationURL: URL,
        redirectURI: URL,
        hostIdentifier: String,
        requestedClientID: String,
        expectedSubject: String?,
        idTokenHint: String?,
        state: String,
        nonce: String,
        codeVerifier: String,
        discovery: OpenIDConfiguration,
        authorizationGeneration: UInt64
    ) {
        self.authorizationURL = authorizationURL
        self.redirectURI = redirectURI
        self.hostIdentifier = hostIdentifier
        self.requestedClientID = requestedClientID
        self.expectedSubject = expectedSubject
        self.idTokenHint = idTokenHint
        self.state = state
        self.nonce = nonce
        self.codeVerifier = codeVerifier
        self.discovery = discovery
        self.authorizationGeneration = authorizationGeneration
    }
}

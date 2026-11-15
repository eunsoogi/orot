import Foundation
@testable import OpenAIProvider
import XCTest

final class ProviderDisplayCopyTests: XCTestCase {
    func testAuthenticationErrorsPreserveKoreanDisplayFromPackageResources() {
        XCTAssertEqual(ChatGPTOAuthError.invalidHostIdentifier.errorDescription, "기기 식별자 형식이 올바르지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.invalidAuthorizationRequest.errorDescription, "로그인 요청을 준비하지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.invalidRedirectURI.errorDescription, "127.0.0.1 콜백 주소가 올바르지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.discoveryUnavailable.errorDescription, "ChatGPT 로그인 설정을 불러오지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.invalidCallback.errorDescription, "로그인 콜백 응답이 올바르지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.stateMismatch.errorDescription, "로그인 응답이 현재 로그인 시도와 일치하지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.registrationIncomplete.errorDescription, "ChatGPT 동적 클라이언트 등록이 완료되지 않았습니다.")
        XCTAssertEqual(ChatGPTOAuthError.registrationMismatch.errorDescription, "등록된 클라이언트가 요청과 일치하지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.accessDenied.errorDescription, "ChatGPT 권한 요청이 거부되었습니다.")
        XCTAssertEqual(ChatGPTOAuthError.providerFailure.errorDescription, "ChatGPT 로그인을 완료하지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.invalidTokenResponse.errorDescription, "ChatGPT가 올바르지 않은 토큰 응답을 보냈습니다.")
        XCTAssertEqual(ChatGPTOAuthError.invalidIdentity.errorDescription, "ChatGPT ID 토큰 검증에 실패했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.accountIdentityMismatch.errorDescription, "선택한 ChatGPT 계정과 로그인 응답이 일치하지 않습니다.")
        XCTAssertEqual(ChatGPTOAuthError.planPermissionMissing.errorDescription, "chatgpt.tokens.use.direct 권한이 허용되지 않았습니다.")
        XCTAssertEqual(ChatGPTOAuthError.modelCatalogUnavailable.errorDescription, "/v1/models 목록을 가져오지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.credentialStoreUnavailable.errorDescription, "보호된 로그인 정보를 저장하거나 불러오지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.accountNotFound.errorDescription, "저장된 ChatGPT 계정을 찾지 못했습니다.")
        XCTAssertEqual(ChatGPTOAuthError.reauthorizationRequired.errorDescription, "ChatGPT 로그인이 만료되었습니다. 다시 로그인해 주세요.")
        XCTAssertEqual(ChatGPTOAuthError.sessionSigningOut.errorDescription, "ChatGPT 로그아웃이 진행 중입니다.")
    }

    func testCallbackNoticesResolveWithoutApplicationBundleResources() {
        XCTAssertEqual(ProviderDisplayCopy.text("callbackInvalid"), "콜백 요청이 올바르지 않습니다. Orot 앱으로 돌아가세요.")
        XCTAssertEqual(ProviderDisplayCopy.text("callbackMissing"), "로그인 응답을 찾지 못했습니다. Orot 앱으로 돌아가세요.")
        XCTAssertEqual(ProviderDisplayCopy.text("callbackReceived"), "로그인 응답을 받았습니다. Orot 앱으로 돌아가세요.")
        XCTAssertEqual(ProviderDisplayCopy.text("listenerUnavailable"), "127.0.0.1 콜백 리스너를 시작하지 못했습니다.")
    }
}

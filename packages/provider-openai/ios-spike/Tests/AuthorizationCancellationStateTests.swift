import XCTest
@testable import ChatGPTOAuthSpikeSupport

final class AuthorizationCancellationStateTests: XCTestCase {
    func testCancellationBeforeCredentialPersistenceReportsNoSavedSession() {
        let state = AuthorizationCancellationState.awaitingAuthorization

        XCTAssertEqual(state.cancelButtonTitle, "로그인 취소")
        XCTAssertEqual(
            state.cancellationMessage,
            "로그인이 취소되었습니다. 인증 정보는 저장하지 않았습니다."
        )
    }

    func testCancellationDuringModelRequestReportsPersistedSession() {
        let state = AuthorizationCancellationState.credentialsStored

        XCTAssertEqual(state.cancelButtonTitle, "모델 확인 취소")
        XCTAssertEqual(
            state.cancellationMessage,
            "모델 확인을 취소했습니다. ChatGPT 인증 정보는 저장되어 있습니다."
        )
    }
}

import XCTest

final class NativeTestConnectionTests: XCTestCase {
    /// A first connection check proves an actual XCUI runner can launch the app and read its test-only host.
    /// It is target wiring evidence, not the completed Speech or product journey.
    @MainActor
    func testNativeTestHostLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_NATIVE_TEST_HOST", "YES"]
        app.launch()
        XCTAssertTrue(app.otherElements["native-integration-host"].waitForExistence(timeout: 30))
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "native-test-host"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
    }
}

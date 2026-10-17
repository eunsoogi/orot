import XCTest

final class TestHostConnectionTests: OrotFailFastTestCase {
    /// A first connection check proves an actual XCUI runner can launch the app and read its test-only host.
    /// It is target wiring evidence, not the completed Speech or product journey.
    @MainActor
    func testHostLaunches() {
        let app = XCUIApplication()
        app.launchArguments = ["-OROT_TEST_HOST", "YES"]
        app.launch()
        XCTAssertTrue(app.otherElements["integration-test-host"].waitForAppearance())
        let screenshot = XCTAttachment(screenshot: app.screenshot())
        screenshot.name = "test-host"
        screenshot.lifetime = .keepAlways
        add(screenshot)
        app.terminate()
    }
}

import XCTest

final class PersistenceUITests: XCTestCase {
    override func setUp() {
        super.setUp()
        continueAfterFailure = false
    }

    @MainActor
    func testEncryptedSourceAndEvidenceSurviveProcessRestart() {
        let app = XCUIApplication()
        let fixture = ["-OROT_TEST_STORAGE_FIXTURE", "test-storage-\(UUID().uuidString)"]
        launch(app, arguments: ["-OROT_STORAGE_PROBE", "fresh"] + fixture)
        success(app, "storage-probe-fresh-success")
        app.terminate()
        launch(app, arguments: ["-OROT_STORAGE_PROBE", "restart"] + fixture)
        success(app, "storage-probe-restart-success")
        app.terminate()
    }

    @MainActor
    func testRemovedMemoryAndHybridEvidenceDoNotReturnAfterRelaunch() {
        let app = XCUIApplication()
        // Preserve one case-owned source and vector ID across all process restarts.
        let fixture = ["-OROT_TEST_MEMORY_FIXTURE", "test-memory-\(UUID().uuidString)"]
        launch(app, arguments: ["-OROT_AGENT_MEMORY_PROBE", "fresh"] + fixture)
        success(app, "agent-memory-probe-success")
        app.terminate()
        launch(app, arguments: ["-OROT_AGENT_MEMORY_PROBE", "restart"] + fixture)
        success(app, "agent-memory-probe-success")
        app.terminate()
        launch(app, arguments: ["-OROT_AGENT_MEMORY_PROBE", "verify-deletion"] + fixture)
        success(app, "agent-memory-probe-success")
        app.terminate()
    }

    @MainActor
    func testUtf8CheckpointResumesWithoutRepeatingCompletedNode() {
        let app = XCUIApplication()
        let arguments = ["-OROT_E2E_PROBE", "checkpoint"]
        launch(app, arguments: arguments)
        success(app, "checkpoint-ready")
        UITestConditions.element(app, "checkpoint-start").tap()
        success(app, "checkpoint-saved")
        app.terminate()
        launch(app, arguments: arguments)
        success(app, "checkpoint-ready")
        UITestConditions.element(app, "checkpoint-resume").tap()
        success(app, "checkpoint-complete")
        UITestConditions.value(UITestConditions.element(app, "checkpoint-result"), equals: "value=8; nodes=increment,double; note=환자 기록: café 🌱🩺")
        app.terminate()
    }

    @MainActor
    private func launch(_ app: XCUIApplication, arguments: [String]) {
        app.launchArguments = ["-OROT_TEST_PROFILE", "core"] + arguments
        app.launch()
    }

    @MainActor
    private func success(_ app: XCUIApplication, _ id: String) {
        XCTAssertTrue(UITestConditions.element(app, id).waitForExistence(timeout: 30), app.debugDescription)
    }
}

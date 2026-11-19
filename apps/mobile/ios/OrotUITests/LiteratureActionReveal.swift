import XCTest

@MainActor
enum LiteratureActionReveal {
    /// Follow the identified article action, avoiding repeated snapshots of the moving anonymous content tree.
    static func reveal(_ action: XCUIElement, in app: XCUIApplication, dock: XCUIElement) throws {
        let screen = UITestConditions.element(app, "external-medical-evidence-screen")
        let scroll = screen.scrollViews.firstMatch
        guard UITestConditions.exists(scroll), UITestConditions.exists(action), UITestConditions.exists(dock) else {
            throw NSError(domain: "LiteratureActionReveal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing literature viewport, action, or dock"])
        }
        for attempt in 0 ... 20 {
            let windowFrame = app.frame
            let scrollFrame = scroll.frame
            let dockFrame = dock.frame
            let actionFrame = action.frame
            guard let viewport = LiteratureActionGeometry.viewport(window: windowFrame, scroll: scrollFrame, dock: dockFrame),
                  let decision = LiteratureActionGeometry.decide(window: windowFrame, scroll: scrollFrame, dock: dockFrame, target: actionFrame)
            else {
                throw NSError(domain: "LiteratureActionReveal", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid measured literature geometry: window=\(windowFrame), scroll=\(scrollFrame), dock=\(dockFrame), action=\(actionFrame)"])
            }
            if decision == .visible {
                return
            }
            guard attempt < 20 else { break }
            let origin = app.coordinate(withNormalizedOffset: .zero)
            let x = viewport.midX - windowFrame.minX
            let startY = viewport.minY + viewport.height * (decision == .up ? 0.75 : 0.25)
            let endY = viewport.minY + viewport.height * (decision == .up ? 0.25 : 0.75)
            let start = origin.withOffset(CGVector(dx: x, dy: startY - windowFrame.minY))
            let end = origin.withOffset(CGVector(dx: x, dy: endY - windowFrame.minY))
            start.press(forDuration: 0.05, thenDragTo: end)
        }
        throw NSError(domain: "LiteratureActionReveal", code: 3, userInfo: [NSLocalizedDescriptionKey: "Article action did not enter the measured viewport"])
    }
}

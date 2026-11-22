import XCTest

@MainActor
enum LiteratureActionReveal {
    /// Follow the identified article action, avoiding repeated snapshots of the moving anonymous content tree.
    static func reveal(_ action: XCUIElement, in app: XCUIApplication, dock: XCUIElement) throws {
        let screen = UITestConditions.element(app, "external-medical-evidence-screen")
        let scroll = screen.scrollViews.firstMatch
        guard screen.exists, scroll.exists, dock.exists else {
            throw NSError(domain: "LiteratureActionReveal", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing literature viewport or dock"])
        }
        for attempt in 0 ... 20 {
            guard let window = FormWindowOwnership.resolve(app, scroll: screen, target: action) else {
                throw NSError(domain: "LiteratureActionReveal", code: 4, userInfo: [NSLocalizedDescriptionKey: "Missing literature window owner"])
            }
            let windowFrame = window.frame
            let scrollFrame = scroll.frame
            let dockFrame = dock.frame
            let actionFrame = action.exists ? action.frame : nil
            guard let viewport = LiteratureActionGeometry.viewport(window: windowFrame, scroll: scrollFrame, dock: dockFrame),
                  let decision = LiteratureActionGeometry.decide(window: windowFrame, scroll: scrollFrame, dock: dockFrame, target: actionFrame)
            else {
                throw NSError(domain: "LiteratureActionReveal", code: 2, userInfo: [NSLocalizedDescriptionKey: "Invalid measured literature geometry: window=\(windowFrame), scroll=\(scrollFrame), dock=\(dockFrame), action=\(String(describing: actionFrame))"])
            }
            if decision == .visible {
                return
            }
            guard attempt < 20 else { break }
            let origin = window.coordinate(withNormalizedOffset: .zero)
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

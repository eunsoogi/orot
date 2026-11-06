#if OROT_TESTS
    import UIKit

    /// Samples alert presentation geometry without reading action titles or changing presentation.
    enum MenuPresentationTestObservation {
        static func snapshot() -> [[String: Any]] {
            precondition(Thread.isMainThread)
            let windows = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.flatMap(\.windows)
            var result: [[String: Any]] = []
            func visit(_ controller: UIViewController) {
                if let alert = controller as? UIAlertController {
                    let presenter = alert.presentingViewController
                    let view = alert.viewIfLoaded
                    let window = view?.window
                    let presentation = alert.presentationController
                    let source = alert.popoverPresentationController?.sourceView
                    result.append([
                        "windowBounds": bounds(window),
                        "sceneOrientation": window?.windowScene?.interfaceOrientation.rawValue as Any? ?? NSNull(),
                        "idiom": alert.traitCollection.userInterfaceIdiom.rawValue,
                        "hasPresenter": presenter != nil,
                        "presenterIsPresentingAlert": presenter?.presentedViewController === alert,
                        "presenterSameWindow": window != nil && presenter?.viewIfLoaded?.window === window,
                        "presenterSameScene": window?.windowScene != nil && presenter?.viewIfLoaded?.window?.windowScene === window?.windowScene,
                        "presenterBounds": bounds(presenter?.viewIfLoaded),
                        "presenterInWindow": inWindow(presenter?.viewIfLoaded),
                        "presentedBounds": bounds(view),
                        "presentedInWindow": inWindow(view),
                        "containerBounds": bounds(presentation?.containerView),
                        "containerInWindow": inWindow(presentation?.containerView),
                        "containerSameWindow": window != nil && presentation?.containerView?.window === window,
                        "presentationStyle": alert.modalPresentationStyle.rawValue,
                        "hasPopover": alert.popoverPresentationController != nil,
                        "hasSourceView": source != nil,
                        "sourceSameWindow": window != nil && source?.window === window,
                        "popoverSourceInWindow": inWindow(source),
                        "popoverSourceRect": alert.popoverPresentationController.map { rect($0.sourceRect) } ?? [:],
                    ])
                }
                controller.children.forEach(visit)
                if let presented = controller.presentedViewController {
                    visit(presented)
                }
            }
            windows.filter(\.isKeyWindow).compactMap(\.rootViewController).forEach(visit)
            return result
        }

        private static func bounds(_ view: UIView?) -> [String: CGFloat] {
            view.map { rect($0.bounds) } ?? [:]
        }

        private static func inWindow(_ view: UIView?) -> [String: CGFloat] {
            guard let view, let window = view.window else {
                return [:]
            }
            return rect(view.convert(view.bounds, to: window))
        }

        private static func rect(_ value: CGRect) -> [String: CGFloat] {
            ["x": value.minX, "y": value.minY, "width": value.width, "height": value.height]
        }
    }
#endif

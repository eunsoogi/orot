import Foundation
import UIKit

/// Creates synthetic PDFs only for Simulator test launches, so the UI journey still selects through UIKit.
enum MedicalDocumentPickerTestFixtures {
    static func prepareDirectoryIfRequested() throws -> URL? {
        #if OROT_TESTS && targetEnvironment(simulator)
            let arguments = ProcessInfo.processInfo.arguments
            guard
                let index = arguments.firstIndex(of: "-OROT_TEST_MEDICAL_DOCUMENT_FIXTURE"),
                arguments.indices.contains(index + 1)
            else {
                return nil
            }

            let fixture = arguments[index + 1]
            let filename: String
            let data: Data
            switch fixture {
            case "text-pdf":
                filename = "MedicalDocumentTextFixture.pdf"
                data = textPDF()
            case "scanned-pdf":
                filename = "MedicalDocumentScannedFixture.pdf"
                data = scannedPDF()
            default:
                throw NSError(domain: "MedicalDocumentPickerTestFixtures", code: 1)
            }

            let documents = try FileManager.default.url(
                for: .documentDirectory,
                in: .userDomainMask,
                appropriateFor: nil,
                create: true,
            )
            let directory = documents.appendingPathComponent(
                "MedicalDocumentPickerFixtures",
                isDirectory: true,
            )
            try FileManager.default.createDirectory(
                at: directory,
                withIntermediateDirectories: true,
            )
            try data.write(
                to: directory.appendingPathComponent(filename),
                options: .atomic,
            )
            return directory
        #else
            return nil
        #endif
    }

    #if OROT_TESTS && targetEnvironment(simulator)
        private static func textPDF() -> Data {
            let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
            return UIGraphicsPDFRenderer(bounds: bounds).pdfData { renderer in
                for text in ["Synthetic medical document page one", "Synthetic medical document page two"] {
                    renderer.beginPage()
                    text.draw(
                        at: CGPoint(x: 30, y: 40),
                        withAttributes: [.font: UIFont.systemFont(ofSize: 14)],
                    )
                }
            }
        }

        private static func scannedPDF() -> Data {
            let bounds = CGRect(x: 0, y: 0, width: 612, height: 792)
            let image = UIGraphicsImageRenderer(size: bounds.size).image { _ in
                UIColor.white.setFill()
                UIRectFill(CGRect(origin: .zero, size: bounds.size))
                ("Synthetic scanned page" as NSString).draw(
                    at: CGPoint(x: 30, y: 40),
                    withAttributes: [.font: UIFont.systemFont(ofSize: 14)],
                )
            }
            return UIGraphicsPDFRenderer(bounds: bounds).pdfData { renderer in
                renderer.beginPage()
                image.draw(in: bounds)
            }
        }
    #endif
}

// Face boxes for the placement lint (lib/faces.mjs compiles and runs this).
//   faces <dir of frames NNNNN.jpg> <fps>  →  JSON on stdout: [{ "t": s, "faces": [[x, y, w, h], ...] }]
// Boxes are fractions of the frame, top-left origin, from Apple Vision (VNDetectFaceRectanglesRequest).
import Foundation
import Vision
import AppKit

let args = CommandLine.arguments
let dir = URL(fileURLWithPath: args[1]), fps = Double(args[2]) ?? 5
let files = try FileManager.default.contentsOfDirectory(atPath: dir.path).filter { $0.hasSuffix(".jpg") }.sorted()
var out: [[String: Any]] = []
for (i, f) in files.enumerated() {
  guard let img = NSImage(contentsOf: dir.appendingPathComponent(f)),
        let cg = img.cgImage(forProposedRect: nil, context: nil, hints: nil) else { continue }
  let req = VNDetectFaceRectanglesRequest()
  try? VNImageRequestHandler(cgImage: cg, options: [:]).perform([req])
  let faces = (req.results ?? []).map { o -> [Double] in
    let b = o.boundingBox
    let v: [Double] = [Double(b.minX), Double(1 - b.maxY), Double(b.width), Double(b.height)]
    return v.map { ($0 * 10000).rounded() / 10000 }
  }
  out.append(["t": (Double(i) / fps * 1000).rounded() / 1000, "faces": faces])
}
let data = try JSONSerialization.data(withJSONObject: out)
FileHandle.standardOutput.write(data)

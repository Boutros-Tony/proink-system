// Reads PDFs from stdin and prints their text. Input: repeated [4-byte big-endian length][PDF bytes].
// Output: one JSON line per PDF: {"pages": n, "text": "..."}.
import Foundation
import PDFKit

let input = FileHandle.standardInput
let output = FileHandle.standardOutput

func readExactly(_ count: Int) -> Data? {
  var data = Data()
  while data.count < count {
    let chunk = input.readData(ofLength: count - data.count)
    if chunk.isEmpty { return nil }
    data.append(chunk)
  }
  return data
}

while let header = readExactly(4) {
  let length = header.reduce(0) { ($0 << 8) | Int($1) }
  guard let bytes = readExactly(length) else { break }
  var result: [String: Any] = ["pages": 0, "text": ""]
  if let document = PDFDocument(data: bytes) {
    result = ["pages": document.pageCount, "text": document.string ?? ""]
  }
  let line = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
  output.write(line)
  output.write(Data("\n".utf8))
}

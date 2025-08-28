import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create a temporary file with the given content
 */
export function createTempFile(content: string, filename = "temp.txt"): string {
  const tempDir = mkdtempSync(join(tmpdir(), "pullfrog-"));
  const filePath = join(tempDir, filename);
  writeFileSync(filePath, content);
  return filePath;
}

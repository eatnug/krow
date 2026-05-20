import { existsSync, readdirSync, readFileSync } from "node:fs";
import { parseGlossary } from "../../domains/language/glossary.js";
import { parseSystemDocument } from "../../domains/language/system-document.js";
import { parseSystemMap } from "../../domains/language/system-map.js";
import type { LanguageStore } from "../../outbound-ports/language-store.js";
import { absolutePath, glossaryPath, systemDocsPath, systemMapPath } from "./krow-paths.js";

function readOptional(ref: string, rootDir: string): string {
  const filePath = absolutePath(ref, rootDir);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

export class FilesystemLanguageStore implements LanguageStore {
  loadLanguageContext(rootDir = process.cwd()) {
    const glossaryRef = glossaryPath();
    const systemMapRef = systemMapPath();
    const docsRef = systemDocsPath();
    const docsDir = absolutePath(docsRef, rootDir);
    const systemDocuments = existsSync(docsDir)
      ? readdirSync(docsDir, { withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => {
            const ref = `${docsRef}/${entry.name}`;
            return parseSystemDocument(ref, readOptional(ref, rootDir));
          })
      : [];

    return {
      glossary: parseGlossary(glossaryRef, readOptional(glossaryRef, rootDir)),
      systemMap: parseSystemMap(systemMapRef, readOptional(systemMapRef, rootDir)),
      systemDocsRootRef: docsRef,
      systemDocuments,
    };
  }
}

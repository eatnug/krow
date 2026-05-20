import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { DocumentTemplateName, TemplateReader } from "../../outbound-ports/template-reader.js";

function packageRoot(): string {
  let current = path.dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 8; depth += 1) {
    const packagePath = path.join(current, "package.json");
    if (existsSync(packagePath)) {
      const parsed = JSON.parse(readFileSync(packagePath, "utf8")) as { name?: unknown };
      if (parsed.name === "krow-cli") {
        return current;
      }
    }
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }
    current = parent;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
}

export class FilesystemTemplateReader implements TemplateReader {
  readDocumentTemplate(name: DocumentTemplateName): string {
    const templatePath = path.join(packageRoot(), "src/infrastructure/templates/documents", name);
    if (!existsSync(templatePath)) {
      throw new Error(`document template does not exist: ${name}`);
    }
    return readFileSync(templatePath, "utf8");
  }
}

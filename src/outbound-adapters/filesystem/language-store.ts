import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseGlossary } from "../../domains/language/glossary.js";
import { parseSystemDocument } from "../../domains/language/system-document.js";
import { parseSystemMap } from "../../domains/language/system-map.js";
import type { LanguageStore } from "../../outbound-ports/language-store.js";
import type { LanguageUpdateProposal } from "../../domains/work/work-output-contracts.js";
import { absolutePath, glossaryPath, systemDocsPath, systemMapPath } from "./krow-paths.js";

function readOptional(ref: string, rootDir: string): string {
  const filePath = absolutePath(ref, rootDir);
  return existsSync(filePath) ? readFileSync(filePath, "utf8") : "";
}

function markdownList(items: string[], empty = "(none)"): string[] {
  return items.length === 0 ? [`- ${empty}`] : items.map((item) => `- ${item}`);
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "language-update";
}

function idSlug(value: string): string {
  return slugify(value).replace(/-/g, ".");
}

function updateTitle(update: LanguageUpdateProposal): string {
  return (update.title ?? update.target ?? update.summary.split(/[.:]/)[0] ?? "Language Update").trim();
}

function updateEvidence(update: LanguageUpdateProposal): string[] {
  return [...new Set([...(update.evidence ?? []), ...(update.refs ?? [])])];
}

function appendSection(ref: string, content: string, rootDir: string): string {
  const filePath = absolutePath(ref, rootDir);
  mkdirSync(path.dirname(filePath), { recursive: true });
  const existing = existsSync(filePath) ? readFileSync(filePath, "utf8").trimEnd() : "";
  writeFileSync(filePath, `${existing}${existing ? "\n\n" : ""}${content.trimEnd()}\n`, "utf8");
  return ref;
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
      systemDocuments,
    };
  }

  appendLanguageUpdateProposals(updates: LanguageUpdateProposal[], rootDir = process.cwd()): string | undefined {
    if (updates.length === 0) {
      return undefined;
    }

    const ref = ".krow/system/language-update-proposals.md";
    const filePath = absolutePath(ref, rootDir);
    mkdirSync(path.dirname(filePath), { recursive: true });
    const existing = existsSync(filePath) ? readFileSync(filePath, "utf8") : "# Language Update Proposals\n\n";
    const next = [
      existing.trimEnd(),
      "",
      `## ${new Date().toISOString()}`,
      "",
      ...updates.flatMap((update, index) => [
        `### ${index + 1}. ${update.kind}`,
        "",
        `Summary: ${update.summary}`,
        `Target: ${update.target ?? "(new)"}`,
        "",
        "Evidence:",
        ...markdownList(update.evidence ?? []),
        "",
      ]),
    ].join("\n");
    writeFileSync(filePath, `${next}\n`, "utf8");
    return ref;
  }

  applyApprovedLanguageUpdates(updates: LanguageUpdateProposal[], rootDir = process.cwd()): string[] {
    const appliedRefs: string[] = [];
    for (const update of updates) {
      const title = updateTitle(update);
      const id = idSlug(update.target ?? title);
      const evidence = updateEvidence(update);
      if (update.kind === "term") {
        appliedRefs.push(this.applyGlossaryTerm(title, id, update.summary, evidence, rootDir));
      } else if (update.kind === "system-map") {
        appliedRefs.push(this.applySystemMapEntry(title, id, update.summary, evidence, rootDir));
      } else {
        appliedRefs.push(this.applySystemDocument(title, id, update.summary, evidence, rootDir));
      }
    }
    return [...new Set(appliedRefs)];
  }

  private applyGlossaryTerm(title: string, id: string, summary: string, evidence: string[], rootDir: string): string {
    const ref = glossaryPath();
    const existing = readOptional(ref, rootDir);
    if (existing.includes(`ID: TERM:${id}`) || existing.includes(`## ${title}`)) {
      return ref;
    }
    return appendSection(ref, [
      `## ${title}`,
      "",
      `ID: TERM:${id}`,
      "Kind: Noun",
      "Status: Approved",
      "",
      "Meaning:",
      summary,
      "",
      "Boundary:",
      "Use this term for the approved meaning captured by the referenced work evidence.",
      "",
      "Aliases:",
      "- (none)",
      "",
      "References:",
      ...markdownList(evidence, "(none)").map((item) => item.replace(/^- /, "- evidence: ")),
    ].join("\n"), rootDir);
  }

  private applySystemMapEntry(title: string, id: string, summary: string, evidence: string[], rootDir: string): string {
    const ref = systemMapPath();
    const existing = readOptional(ref, rootDir);
    if (existing.includes(`ID: MAP:${id}`) || existing.includes(`## ${title}`)) {
      return ref;
    }
    return appendSection(ref, [
      `## ${title}`,
      "",
      `ID: MAP:${id}`,
      "Status: Approved",
      "",
      "Summary:",
      summary,
      "",
      "System Documents:",
      "- (none)",
      "",
      "Entry Points:",
      "- (none)",
      "",
      "References:",
      ...markdownList(evidence, "(none)").map((item) => item.replace(/^- /, "- evidence: ")),
    ].join("\n"), rootDir);
  }

  private applySystemDocument(title: string, id: string, summary: string, evidence: string[], rootDir: string): string {
    const ref = `${systemDocsPath()}/${slugify(title)}.md`;
    const filePath = absolutePath(ref, rootDir);
    mkdirSync(path.dirname(filePath), { recursive: true });
    if (existsSync(filePath)) {
      appendSection(ref, [
        `## Approved Update ${new Date().toISOString()}`,
        "",
        "Statement:",
        summary,
        "",
        "References:",
        ...markdownList(evidence, "(none)").map((item) => item.replace(/^- /, "- evidence: ")),
      ].join("\n"), rootDir);
      return ref;
    }
    writeFileSync(filePath, [
      `# ${title}`,
      "",
      `ID: DOC:${id}`,
      "Kind: Responsibility Area",
      "Status: Approved",
      "",
      "Summary:",
      summary,
      "",
      "Notes:",
      "Created from an approved work review language update.",
      "",
      "## Statements",
      "",
      "### Approved Meaning",
      "",
      `ID: STMT:${id}.approved.meaning`,
      "Status: Approved",
      "",
      "Statement:",
      summary,
      "",
      "Terms:",
      "- (none)",
      "",
      "References:",
      ...markdownList(evidence, "(none)").map((item) => item.replace(/^- /, "- evidence: ")),
      "",
      "Notes:",
      "(none)",
      "",
    ].join("\n"), "utf8");
    return ref;
  }
}

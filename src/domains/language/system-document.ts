import type { Reference } from "./references.js";

export interface SystemDocument {
  ref: string;
  title: string;
  terms: string[];
  references: Reference[];
  raw: string;
}

function firstHeading(raw: string, fallback: string): string {
  return raw.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallback;
}

function listItems(section: string | undefined): string[] {
  if (!section) {
    return [];
  }
  return section
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*[-*]\s+(.+)$/)?.[1]?.trim())
    .filter((item): item is string => Boolean(item));
}

function section(raw: string, heading: string): string | undefined {
  const lines = raw.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim().toLowerCase() === `## ${heading.toLowerCase()}`);
  if (start < 0) {
    return undefined;
  }
  const selected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index] ?? "")) {
      break;
    }
    selected.push(lines[index] ?? "");
  }
  return selected.join("\n");
}

export function parseSystemDocument(ref: string, raw: string): SystemDocument {
  return {
    ref,
    title: firstHeading(raw, ref),
    terms: listItems(section(raw, "Related Terms")),
    references: listItems(section(raw, "References")).map((item) => ({
      ref: item,
      kind: item.includes("test") || item.includes("spec") ? "test" : "source",
    })),
    raw,
  };
}

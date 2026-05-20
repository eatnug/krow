export type GlossaryTermStatus = "approved" | "proposed" | "unresolved" | "deprecated";
export type GlossaryNamespace = "core" | "tech" | "project";

export interface GlossaryTerm {
  id: string;
  canonical: string;
  aliases: string[];
  namespace: GlossaryNamespace;
  status: GlossaryTermStatus;
  evidence: string[];
}

export interface Glossary {
  ref: string;
  terms: GlossaryTerm[];
  raw: string;
}

function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

export function glossaryTermMatches(term: GlossaryTerm, text: string): boolean {
  const haystack = normalize(text);
  return [term.canonical, ...term.aliases].some((value) => {
    const needle = normalize(value);
    return needle.length > 0 && haystack.includes(needle);
  });
}

export function parseGlossary(ref: string, raw: string): Glossary {
  const terms: GlossaryTerm[] = [];
  const headingPattern = /^##\s+(.+)$/gm;
  for (const match of raw.matchAll(headingPattern)) {
    const canonical = match[1]?.trim();
    if (!canonical) {
      continue;
    }
    terms.push({
      id: `TERM:${canonical.toLowerCase().replace(/[^a-z0-9가-힣]+/g, ".").replace(/^\.+|\.+$/g, "") || "term"}`,
      canonical,
      aliases: [],
      namespace: "project",
      status: "approved",
      evidence: [ref],
    });
  }

  return { ref, terms, raw };
}

export interface SystemMapEntry {
  title: string;
  ref: string;
  aliases: string[];
  terms: string[];
}

export interface SystemMap {
  ref: string;
  entries: SystemMapEntry[];
  raw: string;
}

export function parseSystemMap(ref: string, raw: string): SystemMap {
  const entries: SystemMapEntry[] = [];
  for (const match of raw.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    entries.push({
      title: match[1]?.trim() || match[2]?.trim() || "System Document",
      ref: match[2]?.trim() || "",
      aliases: [],
      terms: [],
    });
  }
  return { ref, entries: entries.filter((entry) => entry.ref.length > 0), raw };
}

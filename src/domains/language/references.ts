export type ReferenceKind = "source" | "test" | "config" | "runtime-template" | "document";

export interface Reference {
  ref: string;
  kind: ReferenceKind;
  line?: number;
  statement?: string;
}

export function uniqueRefs(refs: string[]): string[] {
  return [...new Set(refs.filter((ref) => ref.trim().length > 0))];
}

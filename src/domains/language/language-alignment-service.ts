import type { Glossary } from "./glossary.js";
import { glossaryTermMatches } from "./glossary.js";
import type { SystemDocument } from "./system-document.js";
import type { SystemMap } from "./system-map.js";
import { uniqueRefs } from "./references.js";

export interface LanguageSystemSnapshot {
  glossary: Glossary;
  systemMap: SystemMap;
  systemDocuments: SystemDocument[];
}

export interface LanguageContextSelection {
  refs: string[];
  matched_terms: string[];
  related_system_documents: string[];
  gaps: string[];
}

export class LanguageAlignmentService {
  selectContextForRequest(input: {
    request: string;
    language: LanguageSystemSnapshot;
  }): LanguageContextSelection {
    const matchedTerms = input.language.glossary.terms
      .filter((term) => term.status === "approved" && glossaryTermMatches(term, input.request))
      .map((term) => term.id);

    const relatedSystemDocuments = input.language.systemDocuments
      .filter((document) => {
        const lower = `${document.title}\n${document.terms.join("\n")}`.toLowerCase();
        return matchedTerms.some((term) => lower.includes(term.toLowerCase())) || document.raw.toLowerCase().includes(input.request.toLowerCase());
      })
      .map((document) => document.ref);

    const refs = uniqueRefs([
      input.language.glossary.ref,
      input.language.systemMap.ref,
      ...relatedSystemDocuments,
    ]);

    const gaps: string[] = [];
    if (input.language.glossary.raw.trim().length === 0 || input.language.glossary.terms.length === 0) {
      gaps.push("glossary has no approved project terms yet");
    }
    if (input.language.systemMap.raw.trim().length === 0) {
      gaps.push("system map has no described system areas yet");
    }

    return {
      refs,
      matched_terms: matchedTerms,
      related_system_documents: relatedSystemDocuments,
      gaps,
    };
  }
}

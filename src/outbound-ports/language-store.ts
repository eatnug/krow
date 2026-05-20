import type { LanguageSystemSnapshot } from "../domains/language/language-alignment-service.js";
import type { LanguageUpdateProposal } from "../domains/work/work-output-contracts.js";

export interface LanguageStore {
  loadLanguageContext(rootDir?: string): LanguageSystemSnapshot;
  appendLanguageUpdateProposals(updates: LanguageUpdateProposal[], rootDir?: string): string | undefined;
  applyApprovedLanguageUpdates(updates: LanguageUpdateProposal[], rootDir?: string): string[];
}

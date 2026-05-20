import type { LanguageSystemSnapshot } from "../domains/language/language-alignment-service.js";

export interface LanguageStore {
  loadLanguageContext(rootDir?: string): LanguageSystemSnapshot;
}

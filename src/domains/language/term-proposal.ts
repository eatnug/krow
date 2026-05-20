import type { Reference } from "./references.js";

export interface TermProposal {
  canonical: string;
  reason: string;
  evidence: Reference[];
}

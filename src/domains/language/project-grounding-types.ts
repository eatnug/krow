export type RouteConfidence = "low" | "medium" | "high";

export type ProjectGlossaryNamespace = "core" | "tech" | "project";
export type ProjectGlossaryTermStatus = "approved" | "proposed" | "unresolved" | "deprecated";

export interface ProjectGlossaryTerm {
  id: string;
  namespace: ProjectGlossaryNamespace;
  canonical: string;
  aliases: string[];
  status: ProjectGlossaryTermStatus;
  source: "builtin" | "glossary_file" | "request";
  evidence?: string[];
}

export interface ProjectGlossaryTermMatch extends ProjectGlossaryTerm {
  matchedText: string;
}

export interface GroundingStatement {
  subject: string;
  relation: string;
  object: string;
  status: "grounded" | "proposed" | "unresolved";
  confidence: RouteConfidence;
  sourceText: string;
}

export interface SystemDocumentMatch {
  key: string;
  title: string;
  ref: string;
  kind?: string;
  layer?: "product" | "system" | string;
  status?: ProjectGlossaryTermStatus;
  aliases: string[];
  relatedTerms: string[];
  references: string[];
  matchedText: string;
  matchFields: string[];
}

export interface ProjectGroundingSummary {
  glossaryRef: string;
  systemMapRef: string;
  vocabularyStatus: "missing" | "seed" | "custom";
  approvedTermCount: number;
  matchedTermCount: number;
  proposedTermCount: number;
  relatedSystemDocumentCount: number;
  unresolvedRelationCount: number;
  requiresClarification: boolean;
}

export interface ProjectGrounding {
  summary: ProjectGroundingSummary;
  matchedTerms: ProjectGlossaryTermMatch[];
  proposedTerms: ProjectGlossaryTerm[];
  relatedSystemDocuments: SystemDocumentMatch[];
  statements: GroundingStatement[];
  notes: string[];
  questions: string[];
}

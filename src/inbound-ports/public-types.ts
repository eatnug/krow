export type {
  AskAction,
  DoneAction,
  FaultAction,
  RunAction,
  WorkAction,
  WorkOutputKind,
} from "../domains/work/work-action.js";
export type { Answer, AnswerPayload, Question } from "../domains/work/questions.js";
export type { PlannedTask, TaskState } from "../domains/work/task-graph.js";
export type {
  ImplementOutput,
  LanguageUpdateProposal,
  PlanOutput,
  ReviewOutput,
} from "../domains/work/work-output-contracts.js";
export type {
  OutputRecord,
  PendingActionState,
  RuntimeSession,
  WorkWorkflowState,
  WorkflowPhase,
  WorkflowStatus,
} from "../domains/work/workflow-state.js";
export type {
  LanguageContextSelection,
  LanguageSystemSnapshot,
} from "../domains/language/language-alignment-service.js";
export type { Glossary, GlossaryTerm as LanguageGlossaryTerm } from "../domains/language/glossary.js";
export type { SystemDocument } from "../domains/language/system-document.js";
export type { SystemMap, SystemMapEntry } from "../domains/language/system-map.js";
export type { CodeCompatibilityIssue } from "../domains/language/code-compatibility.js";
export type { Reference } from "../domains/language/references.js";
export type { TermProposal } from "../domains/language/term-proposal.js";
export type {
  GroundingStatement,
  ProjectGlossaryNamespace as GlossaryNamespace,
  ProjectGlossaryTerm as GlossaryTerm,
  ProjectGlossaryTermMatch as GlossaryTermMatch,
  ProjectGlossaryTermStatus as GlossaryTermStatus,
  ProjectGrounding,
  RouteConfidence,
  SystemDocumentMatch,
} from "../domains/language/project-grounding-types.js";
export type { DocumentTemplateName, TemplateReader } from "../outbound-ports/template-reader.js";

export interface DecisionOption {
  id: string;
  label: string;
  description?: string;
}

export interface DecisionPrompt {
  id: string;
  question: string;
  context?: string;
  kind?: "approval";
  target?: {
    kind: "goal" | "plan" | "glossary" | "system-document" | "scope";
    ref: string;
    status?: string;
  };
  options: DecisionOption[];
}

export interface DecisionAnswer {
  decisionId: string;
  selectedOptionId: string;
  customInput?: string;
}

export interface ValidationResult<T> {
  ok: boolean;
  issues: string[];
  value?: T;
}

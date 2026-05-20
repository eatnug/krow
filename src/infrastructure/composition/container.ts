import { WorkApplicationService } from "../../application/work-application-service.js";
import { LanguageAlignmentService } from "../../domains/language/language-alignment-service.js";
import { DefaultIdGenerator } from "../../outbound-adapters/default-id-generator.js";
import { FilesystemLanguageStore } from "../../outbound-adapters/filesystem/language-store.js";
import { FilesystemTemplateReader } from "../../outbound-adapters/filesystem/template-reader.js";
import { FilesystemWorkDocStore } from "../../outbound-adapters/filesystem/work-doc-store.js";
import { FilesystemWorkflowStateStore } from "../../outbound-adapters/filesystem/workflow-state-store.js";
import { SystemClock } from "../../outbound-adapters/system-clock.js";
import type { WorkUseCases } from "../../inbound-ports/work-use-cases.js";

export function createWorkUseCases(): WorkUseCases {
  const templateReader = new FilesystemTemplateReader();
  return new WorkApplicationService({
    workflowStateStore: new FilesystemWorkflowStateStore(),
    workDocStore: new FilesystemWorkDocStore(templateReader),
    languageStore: new FilesystemLanguageStore(),
    languageAlignmentService: new LanguageAlignmentService(),
    clock: new SystemClock(),
    idGenerator: new DefaultIdGenerator(),
  });
}

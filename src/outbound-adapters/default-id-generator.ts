import type { IdGenerator } from "../outbound-ports/id-generator.js";

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9가-힣]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "work";
}

export class DefaultIdGenerator implements IdGenerator {
  createWorkId(request: string): string {
    const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
    const suffix = Math.random().toString(36).slice(2, 7);
    return `work-${timestamp}-${slugify(request)}-${suffix}`;
  }
}


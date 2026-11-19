import { openDesignDocument, type DesignDocument } from "../systems/modular/schema";

export function readDesignBody(input: unknown) {
  if (!input || typeof input !== "object") {
    return { error: "Send a booth document.", status: 400 as const };
  }
  const opened = openDesignDocument(input);
  if (opened.status === "unavailable") {
    return { error: "Custom carpentry is not available in this studio yet.", status: 400 as const };
  }
  if (opened.status === "invalid") return { error: opened.message, status: 400 as const };
  return { document: opened.document satisfies DesignDocument };
}

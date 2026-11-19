import { NO_CLIENT, type ChatClient } from "@/components/workspace/client-picker";

/** How the job was given to the studio. Pricing treats each one differently. */
export type SourceKind = "simulation" | "technical" | "3d_file" | "description";

export type JobMeta = {
  client: ChatClient;
  margin: number;
  sourceKind: SourceKind;
};

const serverJob: JobMeta = { client: NO_CLIENT, margin: 20, sourceKind: "description" };
let job: JobMeta = serverJob;
const listeners = new Set<() => void>();

export function getJob() {
  return job;
}

export function getServerJob() {
  return serverJob;
}

export function setJob(change: Partial<JobMeta>) {
  job = { ...job, ...change };
  listeners.forEach((listener) => listener());
}

export function subscribeJob(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

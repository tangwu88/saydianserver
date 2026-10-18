/** Deterministic record summaries, separate from AI prose and reference scores. */
export interface ReportVisuals {
  version: 1;
  kind: "sleep" | "health";
  metrics: {
    key: string;
    label: string;
    unit: string;
    average: number;
    latest: number;
    sampleCount: number;
    points: { date: string; value: number }[];
  }[];
  sleep?: {
    totalSeconds: number;
    wakeCount: number | null;
    stages: { key: string; label: string; seconds: number | null }[];
    unclassifiedSeconds: number;
    sessionCount: number | null;
  };
}

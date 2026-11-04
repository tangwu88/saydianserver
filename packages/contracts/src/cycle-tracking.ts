/** Say Ring personal cycle data; distinct from measured physiology and clinical events. */
export type CycleKind = 'settings' | 'period' | 'daily';
export interface CycleRecordContract {
  id: string;
  kind: string;
  data: Record<string, unknown>;
  revision: number;
  deleted: boolean;
}
export interface CycleMutationContract {
  id: string;
  kind: CycleKind;
  data: Record<string, unknown>;
  baseRevision: number;
  deleted: boolean;
  mutationId: string;
}
export interface CycleSyncInput {
  ownerHash: string;
  offsetMinutes: number;
  epoch: number;
  rows: CycleMutationContract[];
}
export interface CycleChangesContract {
  rows: CycleRecordContract[];
  cursor: number;
  hasMore: boolean;
  epoch: number;
}
export interface CyclePredictionContract {
  status:
    | 'collecting'
    | 'record_only'
    | 'incomplete'
    | 'reference'
    | 'needs_confirmation';
  from?: string;
  to?: string;
  modelVersion: string;
  basis: string[];
  lengths: number[];
  enhanced: false;
}
export type CycleAiAction =
  'continue_recording' | 'prepare' | 'check_records' | 'keep_wearing';

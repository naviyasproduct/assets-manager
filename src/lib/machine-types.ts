import type { MachineFixFileKind, MachineStatus } from '@prisma/client';

/** The plain shapes the machine screens receive. No Dates or BigInts - they cross to the browser. */

export type MachineSummary = {
  id: string;
  code: string | null;
  name: string;
  model: string | null;
  manufacturer: string | null;
  status: MachineStatus;
  departmentName: string;
  locationName: string | null;
  photoUrl: string | null;
  /** The latest version number, 0 before the first repair. */
  version: number;
  repairCount: number;
  lastRepairAt: string | null;
};

export type MachineDetail = MachineSummary & {
  serialNumber: string | null;
  departmentId: string;
  locationId: string | null;
  installedAt: string | null;
  notes: string | null;
  createdByName: string | null;
  createdAt: string;
};

export type FixFileRow = {
  id: string;
  kind: MachineFixFileKind;
  fileName: string;
  sizeBytes: number;
  /** Signed-in viewing, with range support for scrubbing a video. */
  url: string;
  /** Videos only: the page anyone with the link can open, on or off site. */
  watchUrl: string | null;
};

export type FixRow = {
  id: string;
  version: number;
  title: string;
  symptom: string | null;
  description: string;
  fixedByName: string;
  fixedAt: string;
  statusAfter: MachineStatus | null;
  recordedByName: string;
  files: FixFileRow[];
};

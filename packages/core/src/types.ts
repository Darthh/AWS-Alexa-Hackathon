import type { NormalizedTariff, PriceSlot } from "tou-rates";

export type { NormalizedTariff, PriceSlot };

export type Cents = number; // integer
export type ZoneId = string;
export type DeviceId = string;
export type HHmm = `${number}${number}:${number}${number}`;

export type Mode = "home" | "away" | "sleep" | "zone";

export interface Household {
  id: string;
  name: string;
  timezone: string;
  zip?: string;
  rateId: string | null;
  mode: Mode;
  activeZones: ZoneId[]; // used when mode === "zone"
  returnAt?: string; // ISO, when away
  autonomy: { idleOff: "auto" | "ask"; zoneOff: "auto" | "ask" };
  awaySetpointF: number; // e.g. 82 (cooling season)
  zones: Zone[];
  devices: Device[];
  rules: Rule[];
}

export interface Zone {
  id: ZoneId;
  name: string;
  aliases: string[];
  lastMotionAt?: string;
  /** Whole-home zone: counts as occupied whenever anyone is home (never set back in zone mode). */
  shared?: boolean;
}

export type DeviceKind =
  | "ev_charger"
  | "dishwasher"
  | "washer"
  | "dryer"
  | "water_heater"
  | "thermostat"
  | "light"
  | "plug"
  | "tv"
  | "console"
  | "speaker"
  | "pc"
  | "printer"
  | "fridge"
  | "router"
  | "aquarium"
  | "fan";

export interface Device {
  id: DeviceId;
  name: string;
  aliases: string[];
  zoneId: ZoneId;
  kind: DeviceKind;
  ratedKw: number; // draw when on/running
  standbyW?: number; // draw when idle/standby
  cycle?: { durationMin: number; energyKwh: number; interruptible: boolean };
  battery?: { capacityKwh: number; maxKw: number; socPercent: number }; // EV
  noisy?: boolean;
  flexible: boolean; // can be time-shifted
  neverOff?: boolean;
  tags?: ("medical" | "security" | "network" | "food")[];
  state: DeviceState;
}

export interface DeviceState {
  on: boolean;
  running?: boolean;
  powerW: number;
  setpointF?: number;
  ecoMode?: boolean;
  lastActiveAt?: string;
}

export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

export type Rule =
  | { id: string; type: "deadline"; deviceId: DeviceId; by: HHmm; targetPercent?: number; days?: Weekday[] }
  | { id: string; type: "quiet_hours"; start: HHmm; end: HHmm; appliesTo: "noisy" }
  | { id: string; type: "comfort"; zoneId?: ZoneId; minF: number; maxF: number; when: "occupied" | "always" }
  | { id: string; type: "never_off"; deviceId: DeviceId }
  | { id: string; type: "ask_first"; deviceId: DeviceId }
  | { id: string; type: "max_load"; kw: number };

export type RuleType = Rule["type"];

export interface TaskRequest {
  deviceId: DeviceId;
  earliestStart?: string;
  finishBy?: string;
  targetPercent?: number;
  after?: DeviceId;
}

export interface PlanStep {
  id: string;
  deviceId: DeviceId;
  action: "run" | "charge" | "set" | "on" | "off";
  start: string;
  end: string;
  kwh: number;
  costCents: Cents;
  reason: string;
}

export interface ConflictOption {
  label: string;
  extraCostCents?: Cents;
  change: Partial<TaskRequest> | { relaxRuleId: string };
}

export interface Conflict {
  deviceId: DeviceId;
  message: string;
  options: ConflictOption[];
}

export interface Plan {
  id: string;
  createdAt: string;
  steps: PlanStep[];
  costCents: Cents;
  baselineCostCents: Cents;
  savingsCents: Cents;
  ruleChecks: { ruleId: string; ok: boolean; note: string }[];
  conflicts: Conflict[];
  status: "proposed" | "applied" | "cancelled";
  /** Per-device savings vs. baseline, used to attribute "shift" savings as steps execute. */
  taskSavings?: Record<DeviceId, Cents>;
  /** The resolved tasks the plan was built from (needed to re-plan and to explain). */
  tasks?: TaskRequest[];
}

export type LedgerSource = "plan" | "away" | "zone" | "sleep" | "idle" | "arrival" | "user" | "undo";

export interface LedgerEntry {
  id: string;
  at: string;
  deviceId?: DeviceId;
  action: string;
  reason: string;
  source: LedgerSource;
  estSavedCents: Cents;
  estimate: boolean;
  before?: Partial<DeviceState>;
  after?: Partial<DeviceState>;
  undoOf?: string;
  undone?: boolean;
  /** Entries written by one user request share a group (one undo reverts the group). */
  groupId?: string;
  /** Set when a later restore (arrival / home) turned this device back on. */
  restoredBy?: string;
  meta?: Record<string, unknown>;
}

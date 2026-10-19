// The simulated world (clock, people, house) — sim admin routes + SSE, not MCP.

export interface SimDevice {
  id: string;
  name: string;
  zoneId: string;
  kind: string;
  ratedKw: number;
  standbyW?: number;
  battery?: { capacityKwh: number; maxKw: number; socPercent: number };
  state: {
    on: boolean;
    running?: boolean;
    powerW: number;
    setpointF?: number;
    ecoMode?: boolean;
  };
  flags: {
    neverOff: boolean;
    askFirst: boolean;
    scheduled: boolean;
    standby: boolean;
  };
}

export interface SimZone {
  id: string;
  name: string;
  shared?: boolean;
  present: boolean;
  occupied: boolean;
  idleMinutes: number | null;
}

export interface LedgerRow {
  id: string;
  at: string;
  deviceId?: string;
  action: string;
  reason: string;
  source: string;
  estSavedCents: number;
  liveSavedCents: number;
  estimate: boolean;
  undone?: boolean;
}

export interface DemoPlan {
  id: string;
  createdAt: string;
  status: "proposed" | "applied" | "cancelled";
  costCents: number;
  baselineCostCents: number;
  savingsCents: number;
  steps: {
    id: string;
    deviceId: string;
    start: string;
    end: string;
    costCents: number;
    kwh: number;
    reason: string;
  }[];
  ruleChecks: { ruleId: string; ok: boolean; note: string }[];
  conflicts: {
    deviceId: string;
    message: string;
    options: { label: string }[];
  }[];
}

export interface Snapshot {
  clock: {
    kind: "sim" | "real";
    now: string;
    playing: boolean;
    speed: number;
    local: string;
    label: string;
    timezone: string;
  };
  household: {
    name: string;
    mode: "home" | "away" | "sleep" | "zone";
    activeZones: string[];
    returnAt: string | null;
    zones: SimZone[];
    devices: SimDevice[];
    rules: { id: string; type: string; summary: string }[];
  };
  tariff: {
    name: string;
    utility: string;
    isDemoRate: boolean;
    today: string;
    warnings: string[];
  };
  price: {
    now: { centsPerKwh: number; periodName: string };
    next: { at: string; centsPerKwh: number; periodName: string } | null;
  };
  strip: {
    start: string;
    end: string;
    centsPerKwh: number;
    periodName: string;
  }[];
  steps: {
    id: string;
    deviceId: string;
    start: string;
    end: string;
    status: string;
  }[];
  ledger: LedgerRow[];
  savings: {
    totalCents: number;
    bySource: { shift: number; idle: number; away: number };
    estimatedCents: number;
  };
  plan: DemoPlan | null;
  powerW: number;
}

export function subscribe(
  base: string,
  onSnapshot: (s: Snapshot) => void,
  onStatus: (ok: boolean) => void,
): () => void {
  const es = new EventSource(`${base}/sim/events`);
  es.addEventListener("snapshot", (e) =>
    onSnapshot(JSON.parse((e as MessageEvent<string>).data) as Snapshot),
  );
  es.onopen = () => onStatus(true);
  es.onerror = () => onStatus(false);
  return () => es.close();
}

async function post(
  base: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = (await res.json()) as { error?: string };
  if (!res.ok)
    throw new Error(result.error ?? `Simulator request failed (${res.status})`);
  return result;
}

export const sim = {
  clock: (
    base: string,
    action: "play" | "pause" | "set" | "speed",
    value?: string | number,
  ) => post(base, "/sim/clock", { action, value }),
  motion: (base: string, zoneId: string, present: boolean) =>
    post(base, "/sim/motion", { zoneId, present }),
  reset: (base: string) => post(base, "/sim/reset"),
};

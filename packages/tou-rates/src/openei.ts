import { isExpired, latestVersions, normalize, rankRates } from "./normalize.ts";
import type { NormalizedTariff, OpenEIRate } from "./types.ts";

export const OPENEI_ENDPOINT = "https://api.openei.org/utility_rates";

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

export interface FetchOptions {
  timezone?: string;
  now?: Date;
  limit?: number;
  endpoint?: string;
}

export class OpenEIError extends Error {
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "OpenEIError";
    this.status = status;
  }
}

function buildUrl(params: Record<string, string>, endpoint = OPENEI_ENDPOINT): string {
  const url = new URL(endpoint);
  for (const [k, v] of Object.entries({ version: "latest", format: "json", ...params })) url.searchParams.set(k, v);
  return url.toString();
}

async function getItems(url: string, fetchImpl: FetchLike): Promise<OpenEIRate[]> {
  const res = await fetchImpl(url);
  if (!res.ok) throw new OpenEIError(`OpenEI request failed with HTTP ${res.status}`, res.status);
  const body = (await res.json()) as { items?: OpenEIRate[]; error?: { message?: string } | string };
  if (body.error) {
    throw new OpenEIError(typeof body.error === "string" ? body.error : (body.error.message ?? "OpenEI error"));
  }
  return body.items ?? [];
}

/** Raw residential rates for a ZIP (unexpired, newest version of each, TOU ranked first). */
export async function fetchRawRatePlans(
  zip: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  opts: FetchOptions = {},
): Promise<OpenEIRate[]> {
  if (!/^\d{5}$/.test(zip)) throw new OpenEIError(`"${zip}" is not a 5-digit ZIP code`);
  const url = buildUrl(
    {
      api_key: apiKey,
      sector: "Residential",
      detail: "full",
      approved: "true",
      address: zip,
      limit: String(opts.limit ?? 50),
      // Without an explicit order the API can return years-old rates first.
      orderby: "startdate",
      direction: "desc",
    },
    opts.endpoint,
  );
  const now = opts.now ?? new Date();
  const items = (await getItems(url, fetchImpl)).filter((r) => !isExpired(r, now) && (r.energyratestructure?.length ?? 0) > 0);
  return rankRates(latestVersions(items));
}

/** Normalized residential rate plans for a ZIP, best TOU candidates first. Unusable rates are skipped. */
export async function fetchRatePlans(
  zip: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  opts: FetchOptions = {},
): Promise<NormalizedTariff[]> {
  const raw = await fetchRawRatePlans(zip, apiKey, fetchImpl, opts);
  const out: NormalizedTariff[] = [];
  for (const r of raw) {
    try {
      out.push(normalize(r, { timezone: opts.timezone, source: "openei" }));
    } catch {
      // Skip rates without a usable energy structure.
    }
  }
  return out;
}

/** One rate by its URDB label. */
export async function fetchRate(
  label: string,
  apiKey: string,
  fetchImpl: FetchLike = fetch,
  opts: FetchOptions = {},
): Promise<NormalizedTariff> {
  const url = buildUrl({ api_key: apiKey, detail: "full", getpage: label }, opts.endpoint);
  const [raw] = await getItems(url, fetchImpl);
  if (!raw) throw new OpenEIError(`No OpenEI rate with label ${label}`, 404);
  return normalize(raw, { timezone: opts.timezone, source: "openei" });
}

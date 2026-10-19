import type { DateTime } from "luxon";

/** Anything we accept as a point in time. Strings must be ISO-8601. */
export type Instant = Date | string | number | DateTime;

export interface TariffPeriod {
  /** 0-based index used by the weekday/weekend schedules. */
  index: number;
  /** "super off-peak" | "off-peak" | "mid-peak" | "peak" (or a utility label). */
  name: string;
  /** Tier-1 energy rate plus adjustment, in cents per kWh (may be fractional). */
  centsPerKwh: number;
}

export interface NormalizedTariff {
  rateId: string;
  utility: string;
  name: string;
  source: "openei" | "fixture" | "demo";
  /** IANA zone the schedules are expressed in (local wall-clock hours). */
  timezone: string;
  periods: TariffPeriod[];
  /** 12 months × 24 hours → period index (0-based). */
  weekday: number[][];
  weekend: number[][];
  fixedMonthlyCents?: number;
  isTou: boolean;
  warnings: string[];
}

export interface PriceSlot {
  start: string;
  end: string;
  centsPerKwh: number;
  periodName: string;
}

export interface PricePoint {
  centsPerKwh: number;
  periodIndex: number;
  periodName: string;
}

/** One tier of an OpenEI `energyratestructure` period. */
export interface OpenEITier {
  max?: number;
  unit?: string;
  rate?: number;
  adj?: number;
  sell?: number;
}

/** The subset of an OpenEI Utility Rate Database item that we read. */
export interface OpenEIRate {
  label: string;
  utility: string;
  name: string;
  uri?: string;
  sector?: string;
  startdate?: number;
  enddate?: number;
  energyratestructure?: OpenEITier[][];
  energyweekdayschedule?: number[][];
  energyweekendschedule?: number[][];
  fixedmonthlycharge?: number;
  fixedchargefirstmeter?: number;
  fixedchargeunits?: string;
}

export interface RatePlanSummary {
  rateId: string;
  utility: string;
  name: string;
  isTou: boolean;
  summary: string;
}

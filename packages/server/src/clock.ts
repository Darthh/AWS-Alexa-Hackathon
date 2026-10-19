import { DateTime } from "luxon";
import { logError } from "./log.ts";

export type TickListener = (now: Date, prev: Date) => void | Promise<void>;

export interface ClockState {
  kind: "sim" | "real";
  now: string;
  playing: boolean;
  speed: number;
}

export interface Clock {
  readonly kind: "sim" | "real";
  now(): Date;
  state(): ClockState;
  /** Listeners run one at a time, in order, for every tick (including time-travel jumps). */
  onTick(fn: TickListener): () => void;
  start(): void;
  stop(): void;
  /** Resolves when all queued tick listeners have finished. */
  settle(): Promise<void>;
}

abstract class BaseClock implements Clock {
  abstract readonly kind: "sim" | "real";
  abstract now(): Date;
  abstract state(): ClockState;
  abstract start(): void;
  abstract stop(): void;

  #listeners = new Set<TickListener>();
  #chain: Promise<void> = Promise.resolve();
  #pending = false;
  protected lastEmitted = 0;

  onTick(fn: TickListener): () => void {
    this.#listeners.add(fn);
    return () => this.#listeners.delete(fn);
  }

  settle(): Promise<void> {
    return this.#chain;
  }

  /** Queue one emission covering lastEmitted → now. */
  protected emit(): Promise<void> {
    const prev = new Date(this.lastEmitted);
    const now = this.now();
    this.lastEmitted = now.getTime();
    this.#chain = this.#chain.then(async () => {
      for (const fn of this.#listeners) {
        try {
          await fn(now, prev);
        } catch (err) {
          logError("clock.tick", err);
        }
      }
    });
    return this.#chain;
  }

  /** Timer-driven emission: skip if the previous one is still running (the next covers the gap). */
  protected emitIfIdle(): void {
    if (this.#pending) return;
    this.#pending = true;
    void this.emit().finally(() => {
      this.#pending = false;
    });
  }
}

/** Simulated clock with play/pause, speed and time travel. Starts paused. */
export class SimClock extends BaseClock {
  readonly kind = "sim" as const;
  #ms: number;
  #playing = false;
  #speed: number;
  #tickMs: number;
  #timer: ReturnType<typeof setInterval> | undefined;

  constructor(start: Date, opts: { speed?: number; tickMs?: number } = {}) {
    super();
    this.#ms = start.getTime();
    this.lastEmitted = this.#ms;
    this.#speed = opts.speed ?? 60;
    this.#tickMs = opts.tickMs ?? 250;
  }

  now(): Date {
    return new Date(this.#ms);
  }

  state(): ClockState {
    return { kind: "sim", now: this.now().toISOString(), playing: this.#playing, speed: this.#speed };
  }

  play(): void {
    this.#playing = true;
    this.start();
  }

  pause(): void {
    this.#playing = false;
    this.stop();
  }

  setSpeed(speed: number): void {
    if (!(speed > 0 && speed <= 3600)) throw new RangeError("speed must be between 1 and 3600");
    this.#speed = speed;
  }

  /** Jump to `to` and run every listener for the elapsed interval. */
  set(to: Date): Promise<void> {
    this.#ms = to.getTime();
    return this.emit();
  }

  advance(ms: number): Promise<void> {
    return this.set(new Date(this.#ms + ms));
  }

  start(): void {
    if (!this.#playing || this.#timer) return;
    this.#timer = setInterval(() => {
      this.#ms += this.#tickMs * this.#speed;
      this.emitIfIdle();
    }, this.#tickMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

export class RealClock extends BaseClock {
  readonly kind = "real" as const;
  #timer: ReturnType<typeof setInterval> | undefined;
  #tickMs: number;

  constructor(tickMs = 15_000) {
    super();
    this.lastEmitted = Date.now();
    this.#tickMs = tickMs;
  }

  now(): Date {
    return new Date();
  }

  state(): ClockState {
    return { kind: "real", now: this.now().toISOString(), playing: true, speed: 1 };
  }

  start(): void {
    if (this.#timer) return;
    this.#timer = setInterval(() => this.emitIfIdle(), this.#tickMs);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = undefined;
  }
}

/** Default sim start: the most recent weekday (today if a weekday) at 5:30 PM local. */
export function defaultSimStart(timezone: string, reference: Date = new Date()): Date {
  let day = DateTime.fromJSDate(reference, { zone: timezone }).startOf("day");
  while (day.weekday >= 6) day = day.minus({ days: 1 });
  return day.set({ hour: 17, minute: 30 }).toJSDate();
}

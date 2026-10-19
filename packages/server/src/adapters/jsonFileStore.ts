import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { logError } from "../log.ts";
import { emptyData, MemoryStore, type StoreData } from "./memoryStore.ts";

/** MemoryStore persisted to one JSON file (debounced, atomic rename). Survives server restarts. */
export class JsonFileStore extends MemoryStore {
  override readonly kind = "json" as const;
  readonly file: string;
  #timer: ReturnType<typeof setTimeout> | undefined;
  #writing: Promise<void> = Promise.resolve();

  constructor(file: string) {
    super();
    this.file = file;
    if (existsSync(file)) {
      try {
        this.data = { ...emptyData(), ...(JSON.parse(readFileSync(file, "utf8")) as Partial<StoreData>) };
      } catch (err) {
        logError("jsonStore.load", err);
      }
    }
  }

  protected override touched(): void {
    if (this.#timer) return;
    this.#timer = setTimeout(() => {
      this.#timer = undefined;
      void this.flush();
    }, 300);
    this.#timer.unref?.();
  }

  override async flush(): Promise<void> {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = undefined;
    }
    const snapshot = JSON.stringify(this.data);
    this.#writing = this.#writing.then(async () => {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
        const tmp = `${this.file}.tmp`;
        await writeFile(tmp, snapshot);
        await rename(tmp, this.file);
      } catch (err) {
        logError("jsonStore.flush", err);
      }
    });
    return this.#writing;
  }
}

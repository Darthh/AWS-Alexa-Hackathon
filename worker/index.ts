import { DurableObject } from "cloudflare:workers";
import { handleAsNodeRequest } from "cloudflare:node";
import { createServer, type Server } from "node:http";
import { createApp } from "../packages/server/src/app.ts";
import { loadConfig } from "../packages/server/src/config.ts";
import { createRuntime, type Runtime } from "../packages/server/src/runtime.ts";
import {
  emptyData,
  MemoryStore,
  type StoreData,
} from "../packages/server/src/adapters/memoryStore.ts";
import planHtml from "../packages/ui-apps/dist/plan.html";

interface Env {
  ASSETS: Fetcher;
  HOME: DurableObjectNamespace<DemoHome>;
}

/** Reuse the complete tested store interface; persist each visitor's home separately. */
class DurableStore extends MemoryStore {
  private storage: DurableObjectStorage;
  private dirty = false;
  constructor(storage: DurableObjectStorage, data?: StoreData) {
    super();
    this.storage = storage;
    this.data = data ?? emptyData();
  }
  protected override touched() {
    this.dirty = true;
  }
  override async flush() {
    if (!this.dirty) return;
    this.dirty = false;
    await this.storage.put("home", structuredClone(this.data));
  }
}

export class DemoHome extends DurableObject<Env> {
  private rt!: Runtime;
  private server!: Server;
  private port!: number;
  private lastSaved = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      const store = new DurableStore(
        ctx.storage,
        await ctx.storage.get<StoreData>("home"),
      );
      this.rt = await createRuntime(
        loadConfig({
          STORE: "memory",
          SIM_ADMIN: "1",
          LLM_MODE: "mock",
          CLOCK: "sim",
          TARIFF_SOURCE: "demo",
          MCP_ALLOWED_HOSTS:
            "localhost,127.0.0.1,offpeak.patrickvaldivia123.workers.dev",
          WEB_ORIGIN: "https://offpeak.patrickvaldivia123.workers.dev",
        }),
        { store, planAppHtml: planHtml },
      );
      const speed = await store.getMeta<number>("worker.speed");
      if (speed && "setSpeed" in this.rt.clock)
        (
          this.rt.clock as import("../packages/server/src/clock.ts").SimClock
        ).setSpeed(speed);
      this.rt.events.on("changed", () => {
        // Clock playback emits 4 times/sec. Persist periodically instead of writing on every tick.
        if (Date.now() - this.lastSaved > 5000) {
          this.lastSaved = Date.now();
          ctx.waitUntil(store.flush());
        }
      });
      this.server = createServer(createApp(this.rt));
      this.server.listen(0);
      this.port = (this.server.address() as { port: number }).port;
      await store.flush();
    });
  }

  override async fetch(request: Request): Promise<Response> {
    // Expire an inactive demo after a day; no background paid services or real device integrations.
    await this.ctx.storage.setAlarm(Date.now() + 24 * 60 * 60 * 1000);
    const response = await handleAsNodeRequest(this.port, request);
    await this.rt.clock.settle();
    await this.rt.store.setMeta("worker.speed", this.rt.clock.state().speed);
    await this.rt.store.flush();
    return response;
  }

  override async alarm() {
    await this.rt.close();
    this.server.close();
    await this.ctx.storage.deleteAll();
    // A visitor returning after expiration gets a newly seeded runtime.
    this.ctx.abort("Inactive demo expired");
  }
}

const API = /^\/(mcp(?:\/|$)|sim(?:\/|$)|llm(?:\/|$))/;
const SESSION = /(?:^|;\s*)offpeak_session=([a-f0-9-]{36})(?:;|$)/;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health")
      return Response.json({
        ok: true,
        name: "off-peak",
        mode: "isolated-demo",
      });
    const existing = request.headers.get("cookie")?.match(SESSION)?.[1];
    const session = existing ?? crypto.randomUUID();
    let response: Response;
    if (API.test(url.pathname)) {
      const origin = request.headers.get("origin");
      if (origin && origin !== url.origin)
        return Response.json(
          { error: "Use the same-origin demo endpoint." },
          { status: 403 },
        );
      const id = env.HOME.idFromName(session);
      response = await env.HOME.get(id).fetch(request);
    } else {
      response = await env.ASSETS.fetch(request);
    }
    const headers = new Headers(response.headers);
    headers.set("X-Content-Type-Options", "nosniff");
    headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    if (API.test(url.pathname)) headers.set("Cache-Control", "no-store");
    if (!existing)
      headers.append(
        "Set-Cookie",
        `offpeak_session=${session}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=86400`,
      );
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
} satisfies ExportedHandler<Env>;

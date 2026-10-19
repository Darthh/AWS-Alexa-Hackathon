// Web Speech API (push-to-talk + speechSynthesis), with optional Amazon Polly via the server.

interface RecognitionResultLike {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<RecognitionResultLike>;
}
interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: RecognitionEventLike) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type RecognitionCtor = new () => RecognitionLike;

function recognitionCtor(): RecognitionCtor | null {
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export const speechInputSupported = () => recognitionCtor() !== null;

export interface Listener {
  start(): void;
  stop(): void;
}

/** Push-to-talk recognizer: interim text while speaking, final text on release. */
export function createListener(handlers: { interim(text: string): void; final(text: string): void; end(): void; error(msg: string): void }): Listener | null {
  const Ctor = recognitionCtor();
  if (!Ctor) return null;
  let rec: RecognitionLike | null = null;
  let finalText = "";
  return {
    start() {
      if (rec) return;
      finalText = "";
      rec = new Ctor();
      rec.lang = "en-US";
      rec.interimResults = true;
      rec.continuous = true;
      rec.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const r = e.results[i]!;
          if (r.isFinal) finalText += r[0].transcript;
          else interim += r[0].transcript;
        }
        handlers.interim((finalText + interim).trim());
      };
      rec.onerror = (e) => {
        if (e.error !== "aborted" && e.error !== "no-speech") handlers.error(e.error);
      };
      rec.onend = () => {
        rec = null;
        handlers.end();
        if (finalText.trim()) handlers.final(finalText.trim());
      };
      rec.start();
    },
    stop() {
      rec?.stop();
    },
  };
}

let currentAudio: HTMLAudioElement | null = null;

function pickVoice(): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
  return (
    voices.find((v) => /Samantha|Google US English|Jenny|Aria|Joanna/i.test(v.name)) ?? voices.find((v) => v.lang === "en-US") ?? voices[0]
  );
}

export function stopSpeaking(): void {
  if ("speechSynthesis" in window) speechSynthesis.cancel();
  currentAudio?.pause();
  currentAudio = null;
}

/** Speak a reply; resolves when done. Uses Polly when the server has it, else the browser voice. */
export async function speak(text: string, opts: { serverBase: string; polly: boolean; muted: boolean }): Promise<void> {
  stopSpeaking();
  if (opts.muted || !text) return;
  if (opts.polly) {
    try {
      const res = await fetch(`${opts.serverBase}/llm/tts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (res.ok) {
        const url = URL.createObjectURL(await res.blob());
        currentAudio = new Audio(url);
        await new Promise<void>((resolve) => {
          currentAudio!.onended = () => resolve();
          currentAudio!.onerror = () => resolve();
          void currentAudio!.play().catch(() => resolve());
        });
        URL.revokeObjectURL(url);
        return;
      }
    } catch {
      // fall through to the browser voice
    }
  }
  if (!("speechSynthesis" in window)) return;
  await new Promise<void>((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.04;
    // Some engines (headless, no voices) never fire onend: cap the wait by a reading-time estimate.
    const guard = setTimeout(resolve, 1500 + text.split(/\s+/).length * 450);
    u.onend = u.onerror = () => {
      clearTimeout(guard);
      resolve();
    };
    speechSynthesis.speak(u);
  });
}

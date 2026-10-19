export type OffPeakErrorCode =
  | "not_found"
  | "ambiguous"
  | "invalid_input"
  | "needs_confirmation"
  | "conflict"
  | "unavailable"
  | "internal";

/**
 * A domain error whose message is safe to speak aloud.
 * Tools turn these into `isError: true` results with `structuredContent.error`.
 */
export class OffPeakError extends Error {
  readonly code: OffPeakErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: OffPeakErrorCode, speakable: string, details?: Record<string, unknown>) {
    super(speakable);
    this.name = "OffPeakError";
    this.code = code;
    this.details = details;
  }
}

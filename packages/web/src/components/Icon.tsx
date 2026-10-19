import type { CSSProperties } from "react";

const paths = {
  grid: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  home: "m3 10 9-7 9 7 M5 9v12h14V9 M9 21v-8h6v8",
  clock: "M12 8v5l3 2 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
  bolt: "m13 2-9 12h7l-1 8 10-13h-8z",
  chart: "M4 3v17h17 M8 15v-4 M13 15V6 M18 15v-7",
  code: "m8 7-5 5 5 5 M16 7l5 5-5 5 M14 4l-4 16",
  mic: "M9 5a3 3 0 0 1 6 0v7a3 3 0 0 1-6 0z M5 10v2a7 7 0 0 0 14 0v-2 M12 19v3 M8 22h8",
  screen: "M3 4h18v13H3z M8 21h8 M12 17v4",
  arrow: "M4 12h16 m-6-6 6 6-6 6",
  external: "M14 3h7v7 M21 3l-12 12 M10 3H3v18h18v-7",
  check: "m5 12 4 4L19 6",
  shield: "m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z m-4 9 3 3 5-6",
  plug: "M8 3v5 M16 3v5 M5 8h14 M7 8v4a5 5 0 0 0 10 0V8 M12 17v5",
  car: "m5 9 2-5h10l2 5 M3 10h18v8H3z M6 18v3 M18 18v3 M6 13h2 M16 13h2",
  washer:
    "M4 2h16v20H4z M4 6h16 M7 4h1 M10 4h1 M17 14a5 5 0 1 1-10 0 5 5 0 0 1 10 0",
  bulb: "M8 16c0-3-3-3-3-7a7 7 0 1 1 14 0c0 4-3 4-3 7z M9 19h6 M10 22h4",
  lock: "M5 10h14v11H5z M8 10V6a4 4 0 0 1 8 0v4",
  volume: "M4 9h4l5-5v16l-5-5H4z M17 8a6 6 0 0 1 0 8 M20 5a10 10 0 0 1 0 14",
  mute: "M4 9h4l5-5v16l-5-5H4z m13 0 5 6 m0-6-5 6",
  menu: "M3 6h18 M3 12h18 M3 18h18",
  info: "M12 11v6 M12 7h.01 M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0",
} as const;

export type IconName = keyof typeof paths;

export function Icon({
  name,
  size = 18,
  style,
}: {
  name: IconName;
  size?: number;
  style?: CSSProperties;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={style}
    >
      <path d={paths[name]} />
    </svg>
  );
}

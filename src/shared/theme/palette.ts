/**
 * HUD colour themes.
 *
 * A theme is defined by a single accent colour; every other token
 * (bright/dim accent, panel tints, borders, glow) is derived from it so a
 * custom colour still produces a coherent palette.
 */

export interface HudThemePreset {
  id: string;
  label: string;
  accent: string;
}

export const HUD_THEMES: HudThemePreset[] = [
  { id: "arc", label: "ARC", accent: "#00e5ff" },
  { id: "ember", label: "EMBER", accent: "#ff8a3d" },
  { id: "matrix", label: "MATRIX", accent: "#37ff8b" },
  { id: "crimson", label: "CRIMSON", accent: "#ff4d6d" },
  { id: "mono", label: "MONO", accent: "#c9d6e4" },
];

export const DEFAULT_ACCENT = "#00e5ff";

export interface ThemeSettings {
  theme: "dark" | "light";
  hudTheme: string;
  hudAccent: string;
}

interface Hsl {
  h: number;
  s: number;
  l: number;
}

export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function hexToHsl(hex: string): Hsl {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16) / 255;
  const g = parseInt(value.slice(2, 4), 16) / 255;
  const b = parseInt(value.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;

  if (max === min) return { h: 0, s: 0, l: l * 100 };

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hsl(h: number, s: number, l: number): string {
  const hue = ((h % 360) + 360) % 360;
  const sat = Math.min(100, Math.max(0, s));
  const light = Math.min(100, Math.max(0, l));
  return `hsl(${hue.toFixed(0)}, ${sat.toFixed(0)}%, ${light.toFixed(0)}%)`;
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function buildPalette(
  accent: string,
  mode: "dark" | "light",
): Record<string, string> {
  const { h, s, l } = hexToHsl(accent);
  const dark = mode === "dark";

  return {
    "--accent": hsl(h, s, dark ? l : Math.min(l, 42)),
    "--accent-bright": hsl(
      h,
      s + 4,
      dark ? Math.min(94, l + 20) : Math.min(52, l + 10),
    ),
    "--accent-dim": hsl(
      h,
      Math.max(14, s - 30),
      dark ? Math.max(14, l - 46) : Math.min(90, l + 46),
    ),
    "--glow-accent": `0 0 12px ${withAlpha(accent, dark ? 0.45 : 0.25)}`,
    "--bg-base": hsl(h, dark ? 34 : 26, dark ? 5 : 97),
    "--bg-panel": hsl(h, dark ? 30 : 24, dark ? 8 : 100),
    "--bg-elevated": hsl(h, dark ? 28 : 22, dark ? 11 : 96),
    "--bg-hover": hsl(h, dark ? 26 : 24, dark ? 15 : 92),
    "--border-subtle": hsl(h, dark ? 26 : 26, dark ? 14 : 89),
    "--border-strong": hsl(h, dark ? 24 : 26, dark ? 20 : 82),
    "--shadow-panel": dark
      ? "0 18px 40px rgba(0, 0, 0, 0.45)"
      : "0 18px 40px rgba(16, 24, 40, 0.12)",
  };
}

export function resolveAccent(hudTheme: string, hudAccent: string): string {
  const preset = HUD_THEMES.find((item) => item.id === hudTheme);
  if (preset) return preset.accent;
  return isHexColor(hudAccent) ? hudAccent.trim().toLowerCase() : DEFAULT_ACCENT;
}

/** Write the generated palette onto `:root` so CSS variables pick it up. */
export function applyHudTheme(settings: ThemeSettings): void {
  if (typeof document === "undefined") return;
  const accent = resolveAccent(settings.hudTheme, settings.hudAccent);
  const root = document.documentElement;
  root.dataset.hudTheme = settings.hudTheme || "arc";
  for (const [key, value] of Object.entries(
    buildPalette(accent, settings.theme),
  )) {
    root.style.setProperty(key, value);
  }
}

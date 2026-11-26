/** Open-Meteo client for the HUD weather panel (no API key required). */

import type { WeatherDay, WeatherReport } from "../../shared/types";

const CACHE_TTL = 10 * 60 * 1000;

interface CacheEntry {
  at: number;
  report: WeatherReport | null;
}

const cache = new Map<string, CacheEntry>();

/** WMO weather codes, as documented by Open-Meteo. */
const DESCRIPTIONS: Record<number, string> = {
  0: "快晴",
  1: "晴れ",
  2: "一部曇り",
  3: "曇り",
  45: "霧",
  48: "霧氷",
  51: "弱い霧雨",
  53: "霧雨",
  55: "強い霧雨",
  56: "着氷性霧雨",
  57: "着氷性霧雨",
  61: "弱い雨",
  63: "雨",
  65: "強い雨",
  66: "着氷性の雨",
  67: "着氷性の雨",
  71: "弱い雪",
  73: "雪",
  75: "強い雪",
  77: "霧雪",
  80: "にわか雨",
  81: "にわか雨",
  82: "激しいにわか雨",
  85: "にわか雪",
  86: "にわか雪",
  95: "雷雨",
  96: "雷雨（雹）",
  99: "雷雨（雹）",
};

export function describeWeather(code: number): string {
  return DESCRIPTIONS[code] ?? "—";
}

interface OpenMeteoResponse {
  current?: { temperature_2m?: number; weather_code?: number };
  daily?: {
    time?: string[];
    weather_code?: number[];
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
  };
}

export async function fetchWeather(
  city: string,
  lat: number,
  lon: number,
): Promise<WeatherReport | null> {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) {
    return cached.report;
  }

  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.searchParams.set("latitude", String(lat));
  url.searchParams.set("longitude", String(lon));
  url.searchParams.set("current", "temperature_2m,weather_code");
  url.searchParams.set(
    "daily",
    "weather_code,temperature_2m_max,temperature_2m_min",
  );
  url.searchParams.set("timezone", "auto");
  url.searchParams.set("forecast_days", "4");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as OpenMeteoResponse;
    const code = data.current?.weather_code ?? 0;
    const days: WeatherDay[] = (data.daily?.time ?? []).map((date, index) => ({
      date,
      min: data.daily?.temperature_2m_min?.[index] ?? 0,
      max: data.daily?.temperature_2m_max?.[index] ?? 0,
      code: data.daily?.weather_code?.[index] ?? 0,
    }));

    const report: WeatherReport = {
      city,
      temp: data.current?.temperature_2m ?? 0,
      code,
      description: describeWeather(code),
      days,
    };
    cache.set(key, { at: Date.now(), report });
    return report;
  } catch {
    // Serve a stale value when possible so the panel keeps its last state.
    const stale = cache.get(key);
    if (stale) return stale.report;
    cache.set(key, { at: Date.now(), report: null });
    return null;
  }
}

import { useState } from "react";
import { Loader2, MapPin, Search } from "lucide-react";
import {
  MAJOR_CITIES,
  searchPlaces,
  type GeoPlace,
} from "../hud/geocode";

export interface WeatherLocation {
  city: string;
  lat: number;
  lon: number;
}

const INPUT_CLASS =
  "min-w-0 flex-1 rounded-md border border-[var(--border-subtle)] " +
  "bg-[var(--bg-elevated)] px-2 py-1 text-[11px] " +
  "text-[var(--text-primary)] outline-none transition " +
  "focus:border-[var(--accent-dim)] select-text";

const CHIP_CLASS =
  "rounded-full border border-[var(--border-strong)] px-2 py-0.5 " +
  "text-[10px] text-[var(--text-secondary)] transition " +
  "hover:border-[var(--accent-dim)] hover:text-[var(--accent)]";

export default function WeatherLocationField({
  value,
  onChange,
}: {
  value: WeatherLocation;
  onChange: (next: WeatherLocation) => void;
}) {
  const [query, setQuery] = useState(value.city);
  const [results, setResults] = useState<GeoPlace[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [manual, setManual] = useState(false);

  const apply = (city: string, lat: number, lon: number) => {
    onChange({ city, lat, lon });
    setQuery(city);
    setResults([]);
    setMessage(null);
  };

  const runSearch = async () => {
    const text = query.trim();
    if (!text) return;
    setBusy(true);
    setMessage(null);
    try {
      const found = await searchPlaces(text);
      setResults(found);
      if (found.length === 0) setMessage("該当する地点が見つかりませんでした");
    } catch {
      setMessage("検索できませんでした（オフラインの可能性）");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-1.5 py-1.5">
      <div className="flex items-center gap-1">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void runSearch();
            }
          }}
          placeholder="都市名で検索（例: 大阪、Osaka、New York）"
          className={INPUT_CLASS}
        />
        <button
          type="button"
          onClick={() => void runSearch()}
          disabled={busy}
          title="都市名で検索"
          className="flex shrink-0 items-center gap-1 rounded-md border border-[var(--border-strong)] px-2 py-1 text-[10px] text-[var(--text-secondary)] transition hover:text-[var(--accent)] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 size={10} className="animate-spin" />
          ) : (
            <Search size={10} />
          )}
          検索
        </button>
      </div>

      <div className="flex flex-wrap gap-1">
        {MAJOR_CITIES.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => apply(preset.name, preset.lat, preset.lon)}
            className={CHIP_CLASS}
          >
            {preset.name}
          </button>
        ))}
      </div>

      {results.length > 0 && (
        <ul className="overflow-hidden rounded-md border border-[var(--border-subtle)]">
          {results.map((place) => (
            <li
              key={`${place.name}-${place.lat}-${place.lon}`}
              className="border-b border-[var(--border-subtle)] last:border-b-0"
            >
              <button
                type="button"
                onClick={() => apply(place.name, place.lat, place.lon)}
                className="flex w-full items-center gap-1.5 px-2 py-1 text-left text-[10px] text-[var(--text-secondary)] transition hover:bg-[var(--bg-hover)] hover:text-[var(--text-primary)]"
              >
                <MapPin size={10} className="shrink-0 text-[var(--accent)]" />
                <span className="truncate">{place.name}</span>
                <span className="truncate text-[var(--text-muted)]">
                  {[place.admin1, place.country].filter(Boolean).join(", ")}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {message && (
        <p className="text-[10px] text-[var(--warn)]">{message}</p>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[10px] text-[var(--text-muted)]">
          現在: {value.city} ({value.lat.toFixed(3)}, {value.lon.toFixed(3)})
        </p>
        <button
          type="button"
          onClick={() => setManual((open) => !open)}
          className="shrink-0 text-[10px] text-[var(--text-muted)] underline decoration-dotted transition hover:text-[var(--accent)]"
        >
          {manual ? "座標を閉じる" : "座標を直接編集"}
        </button>
      </div>

      {manual && (
        <div className="flex items-center gap-1">
          <input
            type="number"
            step="0.0001"
            value={value.lat}
            onChange={(event) =>
              onChange({ ...value, lat: Number(event.target.value) })
            }
            className={`${INPUT_CLASS} text-right`}
            title="緯度"
          />
          <input
            type="number"
            step="0.0001"
            value={value.lon}
            onChange={(event) =>
              onChange({ ...value, lon: Number(event.target.value) })
            }
            className={`${INPUT_CLASS} text-right`}
            title="経度"
          />
        </div>
      )}
    </div>
  );
}

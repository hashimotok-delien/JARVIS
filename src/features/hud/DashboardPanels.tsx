import { useEffect, useState } from "react";
import type {
  HudSettings,
  SystemStats,
  UsageStats,
  WeatherReport,
} from "../../shared/types";

const PANEL_CLASS =
  "rounded-lg border border-[var(--border-subtle)] " +
  "bg-[var(--bg-elevated)] px-2 py-1.5";

const LABEL_CLASS = "text-[9px] tracking-[0.18em] text-[var(--text-muted)]";

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  const gb = bytes / 1024 ** 3;
  if (gb >= 1) return `${gb.toFixed(0)}G`;
  return `${(bytes / 1024 ** 2).toFixed(0)}M`;
}

function formatUptime(seconds: number): string {
  if (!seconds) return "—";
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  if (days > 0) return `${days}d ${hours}h`;
  const minutes = Math.floor((seconds % 3_600) / 60);
  return `${hours}h ${minutes}m`;
}

function Gauge({
  label,
  value,
  text,
}: {
  label: string;
  value: number;
  text: string;
}) {
  const percent = Math.min(100, Math.max(0, value));
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-[24px] shrink-0 text-[9px] text-[var(--text-muted)]">
        {label}
      </span>
      <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-[var(--border-subtle)]">
        <div
          className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-500"
          style={{ width: `${percent}%` }}
        />
      </div>
      <span className="w-[64px] shrink-0 text-right text-[9px] text-[var(--text-secondary)]">
        {text}
      </span>
    </div>
  );
}

function ClockPanel() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const time = now.toLocaleTimeString("ja-JP", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = now.toLocaleDateString("ja-JP", {
    month: "long",
    day: "numeric",
    weekday: "short",
  });

  return (
    <div className={PANEL_CLASS}>
      <p className="font-mono text-lg leading-none text-[var(--accent)]">
        {time}
      </p>
      <p className="mt-0.5 text-[9px] text-[var(--text-muted)]">{date}</p>
    </div>
  );
}

function SystemPanel({ stats }: { stats: SystemStats | null }) {
  const memPercent =
    stats && stats.memTotal ? (stats.memUsed / stats.memTotal) * 100 : 0;
  const diskPercent =
    stats && stats.diskTotal ? (stats.diskUsed / stats.diskTotal) * 100 : 0;

  return (
    <div className={PANEL_CLASS}>
      <p className={LABEL_CLASS}>SYSTEM</p>
      <div className="mt-1 space-y-1">
        <Gauge
          label="CPU"
          value={stats?.cpu ?? 0}
          text={stats ? `${Math.round(stats.cpu)}%` : "—"}
        />
        <Gauge
          label="MEM"
          value={memPercent}
          text={
            stats && stats.memTotal
              ? `${formatBytes(stats.memUsed)}/${formatBytes(stats.memTotal)}`
              : "—"
          }
        />
        <Gauge
          label="DSK"
          value={diskPercent}
          text={
            stats && stats.diskTotal
              ? `${formatBytes(stats.diskUsed)}/${formatBytes(stats.diskTotal)}`
              : "—"
          }
        />
      </div>
      <p className="mt-1 text-[9px] text-[var(--text-muted)]">
        UP {formatUptime(stats?.uptimeSecs ?? 0)}
      </p>
    </div>
  );
}

function WeatherPanel({ report }: { report: WeatherReport | null }) {
  return (
    <div className={PANEL_CLASS}>
      <div className="flex items-baseline justify-between">
        <span className={LABEL_CLASS}>{report?.city ?? "WEATHER"}</span>
        <span className="text-sm text-[var(--accent)]">
          {report ? `${Math.round(report.temp)}°` : "—"}
        </span>
      </div>
      <p className="text-[9px] text-[var(--text-secondary)]">
        {report?.description ?? "取得中…"}
      </p>
      {report && report.days.length > 0 && (
        <div className="mt-1 flex gap-1">
          {report.days.slice(0, 4).map((day, index) => (
            <div key={day.date} className="flex-1 text-center">
              <p className="text-[8px] text-[var(--text-muted)]">
                {index === 0 ? "今日" : day.date.slice(5)}
              </p>
              <p className="text-[8px] text-[var(--text-secondary)]">
                {Math.round(day.max)}°/{Math.round(day.min)}°
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UsagePanel({ usage }: { usage: UsageStats | null }) {
  const today = usage?.today;
  // Rough Japanese/English mix: ~1.6 characters per token.
  const tokens = today ? Math.round(today.characters / 1.6) : 0;

  return (
    <div className={PANEL_CLASS}>
      <p className={LABEL_CLASS}>USAGE / 24H</p>
      <p className="text-[11px] text-[var(--text-secondary)]">
        {today
          ? `${today.requests} 回 · 約 ${tokens.toLocaleString()} tok`
          : "—"}
      </p>
      <p className="text-[9px] text-[var(--text-muted)]">
        {today
          ? `平均 ${Math.round(today.avgLatencyMs)}ms · ` +
            `${today.characters.toLocaleString()} 文字`
          : ""}
      </p>
      {usage && usage.byProvider.length > 0 && (
        <p className="mt-0.5 truncate text-[9px] text-[var(--text-muted)]">
          {usage.byProvider
            .slice(0, 2)
            .map((item) => `${item.provider} ${item.requests}`)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}

export default function Dashboard({
  hud,
  stats,
  weather,
  usage,
}: {
  hud: HudSettings;
  stats: SystemStats | null;
  weather: WeatherReport | null;
  usage: UsageStats | null;
}) {
  const anyPanel =
    hud.showClock || hud.showSystem || hud.showWeather || hud.showUsage;
  if (!anyPanel) return null;

  return (
    <div className="flex w-[268px] shrink-0 flex-col gap-1.5 overflow-y-auto pr-1">
      {hud.showClock && <ClockPanel />}
      {hud.showSystem && <SystemPanel stats={stats} />}
      {hud.showWeather && <WeatherPanel report={weather} />}
      {hud.showUsage && <UsagePanel usage={usage} />}
    </div>
  );
}

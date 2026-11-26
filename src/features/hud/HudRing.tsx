import { motion } from "framer-motion";
import type { HudState } from "../../shared/types";
import { HUD_STATE_META } from "./states";

interface HudRingProps {
  state: HudState;
  size?: number;
  /** Normalized frequency levels emitted while the assistant speaks. */
  spectrum?: number[];
  /** Freeze rotation and pulsing (static/low-power mode). */
  static?: boolean;
}

const BAR_COUNT = 32;
const BAR_INNER = 45;
const BAR_MAX = 15;

export default function HudRing({
  state,
  size = 112,
  spectrum,
  static: isStatic = false,
}: HudRingProps) {
  const meta = HUD_STATE_META[state];
  const isBusy = state === "thinking";
  const active = state === "speaking" || state === "listening";
  const levels =
    spectrum && spectrum.length > 0
      ? spectrum
      : new Array<number>(BAR_COUNT).fill(0);
  const level = active
    ? levels.reduce((sum, value) => sum + value, 0) / levels.length
    : 0;

  return (
    <div
      className="relative shrink-0"
      style={{ width: size, height: size, color: meta.color }}
    >
      <div
        className="absolute inset-0 rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(0,229,255,0.22) 0%, transparent 68%)",
          filter: state === "listening" ? "brightness(1.35)" : undefined,
          transition: "filter 240ms ease",
        }}
      />

      <motion.svg
        viewBox="0 0 120 120"
        className="absolute inset-0"
        animate={isStatic ? undefined : { rotate: 360 }}
        transition={{
          repeat: Infinity,
          duration: meta.spin,
          ease: "linear",
        }}
      >
        <circle
          cx="60"
          cy="60"
          r="56"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="1"
          strokeDasharray="2 7"
        />
        <circle
          cx="60"
          cy="60"
          r="49"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.6"
          strokeWidth="1.5"
          strokeDasharray="70 240"
          strokeLinecap="round"
        />
      </motion.svg>

      <motion.svg
        viewBox="0 0 120 120"
        className="absolute inset-0"
        animate={isStatic ? undefined : { rotate: -360 }}
        transition={{ repeat: Infinity, duration: 22, ease: "linear" }}
      >
        <circle
          cx="60"
          cy="60"
          r="42"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.32"
          strokeWidth="3"
          strokeDasharray="10 26"
          strokeLinecap="round"
        />
      </motion.svg>

      <svg
        viewBox="0 0 120 120"
        className="absolute inset-0"
        aria-hidden="true"
      >
        {levels.map((value, index) => {
          const angle = (index / levels.length) * Math.PI * 2 - Math.PI / 2;
          const amount = active ? Math.min(1, value) : 0;
          const inner = BAR_INNER;
          const outer = inner + 2 + amount * BAR_MAX;
          return (
            <line
              key={index}
              x1={60 + Math.cos(angle) * inner}
              y1={60 + Math.sin(angle) * inner}
              x2={60 + Math.cos(angle) * outer}
              y2={60 + Math.sin(angle) * outer}
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              opacity={active ? 0.35 + amount * 0.65 : 0.12}
            />
          );
        })}
      </svg>

      <div
        className="absolute inset-[30%] rounded-full"
        style={{
          background: "currentColor",
          filter: "blur(5px)",
          opacity: active ? 0.2 + level * 0.55 : 0,
          transform: `scale(${1 + level * 0.7})`,
          transition: "transform 80ms linear, opacity 80ms linear",
        }}
      />

      <motion.div
        className="absolute inset-[34%] rounded-full"
        style={{ background: "currentColor" }}
        animate={
          isStatic
            ? { opacity: 0.9, scale: 1 }
            : {
                opacity: isBusy ? [0.35, 1, 0.35] : [0.7, 1, 0.7],
                scale:
                  state === "listening" ? [0.9, 1.08, 0.9] : [1, 1.04, 1],
              }
        }
        transition={{
          repeat: isStatic ? 0 : Infinity,
          duration: isBusy ? 0.9 : 2.6,
          ease: "easeInOut",
        }}
      />

      <div
        className="absolute inset-[34%] rounded-full"
        style={{ boxShadow: "0 0 24px 6px currentColor", opacity: 0.35 }}
      />
    </div>
  );
}

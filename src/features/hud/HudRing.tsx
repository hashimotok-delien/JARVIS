import { motion } from "framer-motion";
import type { HudState } from "../../shared/types";
import { HUD_STATE_META } from "./states";

interface HudRingProps {
  state: HudState;
  size?: number;
}

export default function HudRing({ state, size = 112 }: HudRingProps) {
  const meta = HUD_STATE_META[state];
  const isBusy = state === "thinking";

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
        animate={{ rotate: 360 }}
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
        animate={{ rotate: -360 }}
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

      <motion.div
        className="absolute inset-[34%] rounded-full"
        style={{ background: "currentColor" }}
        animate={{
          opacity: isBusy ? [0.35, 1, 0.35] : [0.7, 1, 0.7],
          scale: state === "listening" ? [0.9, 1.08, 0.9] : [1, 1.04, 1],
        }}
        transition={{
          repeat: Infinity,
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

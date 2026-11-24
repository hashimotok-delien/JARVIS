import type { HudState } from "../../shared/types";

interface HudStateMeta {
  label: string;
  hint: string;
  color: string;
  spin: number;
}

export const HUD_STATE_META: Record<HudState, HudStateMeta> = {
  idle: {
    label: "待機",
    hint: "スタンバイ。呼びかけてください。",
    color: "#00e5ff",
    spin: 14,
  },
  listening: {
    label: "聞き取り中",
    hint: "音声を認識しています…",
    color: "#34d399",
    spin: 5,
  },
  thinking: {
    label: "思考中",
    hint: "応答を生成しています…",
    color: "#fbbf24",
    spin: 2.4,
  },
  speaking: {
    label: "発話中",
    hint: "読み上げています…",
    color: "#7cf9ff",
    spin: 8,
  },
};

export const HUD_STATE_ORDER: HudState[] = [
  "idle",
  "listening",
  "thinking",
  "speaking",
];

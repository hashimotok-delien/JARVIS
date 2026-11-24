export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  pending?: boolean;
}

export interface Thread {
  id: string;
  title: string;
  updatedAt: number;
  pinned?: boolean;
}

export type HudState = "idle" | "listening" | "thinking" | "speaking";

export interface AppInfo {
  name: string;
  version: string;
}

import { invoke } from "@tauri-apps/api/core";

type LogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR";

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.stack ?? error.message;
  if (typeof error === "string") return error;
  if (error && typeof error === "object") {
    // DOMException and MediaError are not JSON-serializable (their fields are
    // non-enumerable), which used to log as a useless "{}".
    const detail = error as { name?: unknown; message?: unknown };
    if (typeof detail.message === "string" && detail.message) {
      const name = typeof detail.name === "string" ? detail.name : "Error";
      return `${name}: ${detail.message}`;
    }
  }
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export async function writeLog(
  level: LogLevel,
  source: string,
  message: string,
): Promise<void> {
  if (
    typeof window === "undefined" ||
    !("__TAURI_INTERNALS__" in window)
  ) {
    if (level === "ERROR") console.error(`[${source}] ${message}`);
    else if (level === "WARN") console.warn(`[${source}] ${message}`);
    return;
  }

  try {
    await invoke("write_log", { level, source, message });
  } catch (error) {
    console.error("Could not write to JARVIS log file", error);
  }
}

export function logError(source: string, error: unknown): Promise<void> {
  return writeLog("ERROR", source, errorMessage(error));
}

export function logWarning(source: string, message: string): Promise<void> {
  return writeLog("WARN", source, message);
}

export function installGlobalErrorLogging(): void {
  window.addEventListener("error", (event) => {
    void logError("window", event.error ?? event.message);
  });
  window.addEventListener("unhandledrejection", (event) => {
    void logError("unhandled-rejection", event.reason);
  });
}

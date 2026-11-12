import { call } from "./transport";
import type { AppSettings } from "../types";

export async function getSettings(): Promise<AppSettings> {
  return call("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return call("update_settings", { settings });
}

export async function detectRarTool(): Promise<string | null> {
  return call("detect_rar_tool");
}

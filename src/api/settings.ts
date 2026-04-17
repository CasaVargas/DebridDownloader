import { invoke } from "@tauri-apps/api/core";
import type { AppSettings } from "../types";

export async function getSettings(): Promise<AppSettings> {
  return invoke("get_settings");
}

export async function updateSettings(settings: AppSettings): Promise<void> {
  return invoke("update_settings", { settings });
}

export async function detectRarTool(): Promise<string | null> {
  return invoke("detect_rar_tool");
}

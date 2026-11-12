import { call } from "./transport";

export interface ImportResult {
  frontend_settings: string | null;
  imported_sections: string[];
}

export async function exportSettings(
  includeCredentials: boolean,
  frontendSettingsJson: string
): Promise<string> {
  return call("export_settings", {
    includeCredentials,
    frontendSettingsJson,
  });
}

export async function importSettings(json: string): Promise<ImportResult> {
  return call("import_settings", { json });
}

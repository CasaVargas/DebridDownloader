import { call } from "./transport";
import type { ProviderInfo } from "../types";

export async function getAvailableProviders(): Promise<ProviderInfo[]> {
  return call("get_available_providers");
}

export async function switchProvider(providerId: string): Promise<boolean> {
  return call("switch_provider", { providerId });
}

export async function getActiveProvider(): Promise<string> {
  return call("get_active_provider");
}

export async function getAuthMethod(): Promise<"api_key" | "oauth_device"> {
  return call("get_auth_method");
}

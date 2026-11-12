import { call } from "./transport";
import type { DeviceCode, DeviceCredentials, OAuthToken, User } from "../types";

export async function setApiToken(token: string): Promise<void> {
  return call("set_api_token", { token });
}

export async function loadSavedToken(): Promise<boolean> {
  return call("load_saved_token");
}

export async function logout(): Promise<void> {
  return call("logout");
}

export async function isAuthenticated(): Promise<boolean> {
  return call("is_authenticated");
}

export async function getUser(): Promise<User> {
  return call("get_user");
}

export async function oauthStart(): Promise<DeviceCode> {
  return call("oauth_start");
}

export async function oauthPollCredentials(
  deviceCode: string
): Promise<DeviceCredentials | null> {
  return call("oauth_poll_credentials", { deviceCode });
}

export async function oauthGetToken(
  clientId: string,
  clientSecret: string,
  deviceCode: string
): Promise<OAuthToken> {
  return call("oauth_get_token", { clientId, clientSecret, deviceCode });
}

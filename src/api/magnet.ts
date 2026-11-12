import { call } from "./transport";

export async function setMagnetHandler(enabled: boolean): Promise<void> {
  await call("set_magnet_handler", { enabled });
}

/** A magnet URI the app was cold-started with, once; null when there is none. */
export async function getPendingMagnetUri(): Promise<string | null> {
  return call("get_pending_magnet_uri");
}

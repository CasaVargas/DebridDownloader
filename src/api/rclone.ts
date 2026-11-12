import { call } from "./transport";
import type { RcloneInfo } from "../types";

export async function checkRclone(): Promise<RcloneInfo | null> {
  return call("check_rclone");
}

export async function listRcloneRemotes(): Promise<string[]> {
  return call("list_rclone_remotes");
}

export async function validateRcloneRemote(
  remoteName: string
): Promise<boolean> {
  return call("validate_rclone_remote", { remoteName });
}

import { invoke } from "@tauri-apps/api/core";

export async function testMediaServer(
  serverType: string,
  url: string,
  credential: string
): Promise<string> {
  return invoke("test_media_server", { serverType, url, credential });
}

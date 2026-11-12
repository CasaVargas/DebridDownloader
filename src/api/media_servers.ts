import { call } from "./transport";

export async function testMediaServer(
  serverType: string,
  url: string,
  credential: string
): Promise<string> {
  return call("test_media_server", { serverType, url, credential });
}

export const PROVIDER_NAMES: Record<string, string> = {
  "real-debrid": "Real-Debrid",
  torbox: "TorBox",
  premiumize: "Premiumize",
};

export function providerName(id: string): string {
  return PROVIDER_NAMES[id] ?? id;
}

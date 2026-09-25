import { useEffect, useState } from "react";
import { getAvailableProviders, switchProvider, getActiveProvider } from "../../api/providers";
import type { ProviderInfo } from "../../types";
import { useAuth } from "../../hooks/useAuth";
import { providerName } from "../../lib/providers";
import { Button, Select, SettingsGroup, SettingsRow, Spinner } from "../../components/ui";

export default function AccountSettings() {
  const { user, logout } = useAuth();
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [activeProvider, setActiveProvider] = useState("real-debrid");
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    getAvailableProviders().then(setProviders).catch(() => {});
    getActiveProvider().then(setActiveProvider).catch(() => {});
  }, []);

  async function handleSwitchProvider(id: string) {
    if (id === activeProvider) return;
    setSwitching(true);
    try {
      const previousProvider = activeProvider;
      const hasCredentials = await switchProvider(id);
      setActiveProvider(id);
      if (!hasCredentials) {
        localStorage.setItem("previous-provider", previousProvider);
        window.location.reload();
      }
    } catch (e) {
      console.error("Failed to switch provider:", e);
    } finally {
      setSwitching(false);
    }
  }

  const premiumDays = user?.expiration
    ? Math.ceil((new Date(user.expiration).getTime() - Date.now()) / 86400000)
    : 0;
  const plan = user ? (user.premium ? "Premium" : "Free") : "";

  return (
    <SettingsGroup>
      <SettingsRow label="Active provider" description="Select which debrid service to use">
        {switching && <Spinner size="sm" />}
        <Select
          ariaLabel="Active provider"
          value={activeProvider}
          onValueChange={handleSwitchProvider}
          options={(providers.length ? providers : [{ id: activeProvider, name: "" }]).map((p) => ({ value: p.id, label: providerName(p.id) }))}
        />
      </SettingsRow>
      <SettingsRow
        label={user?.username ?? "Account"}
        description={[plan, user?.expiration ? `${premiumDays} days left` : null].filter(Boolean).join(" · ") || undefined}
      >
        <Button variant="danger" size="sm" onClick={() => { void logout(); }}>
          Sign out
        </Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

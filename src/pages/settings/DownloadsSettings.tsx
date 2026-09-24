import { useNavigate } from "react-router-dom";
import { Button, SettingsGroup, SettingsRow } from "../../components/ui";

/** Filled in by Task 12 (after the download engine lands). Until then the old page still owns these settings. */
export default function DownloadsSettings() {
  const navigate = useNavigate();
  return (
    <SettingsGroup>
      <SettingsRow label="Download settings are moving here" description="Folder, speed, extraction, and rclone settings are still on the previous settings page for now.">
        <Button size="sm" onClick={() => navigate("/settings-legacy")}>Open download settings</Button>
      </SettingsRow>
    </SettingsGroup>
  );
}

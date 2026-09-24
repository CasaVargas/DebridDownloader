import { useState } from "react";
import { open as openFile } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import * as torrentsApi from "../api/torrents";
import { Button, Dialog, Input } from "./ui";

interface Props {
  onClose: () => void;
  onAdded: () => void;
  initialMagnet?: string;
}

export default function AddTorrentModal({ onClose, onAdded, initialMagnet }: Props) {
  const [magnet, setMagnet] = useState(initialMagnet ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleAddMagnet = async () => {
    if (!magnet.trim()) {
      setError("Please enter a magnet link");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const result = await torrentsApi.addMagnet(magnet.trim());
      await torrentsApi.selectTorrentFiles(result.id, "all");
      onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleAddFile = async () => {
    const selected = await openFile({
      title: "Select .torrent file",
      filters: [{ name: "Torrent Files", extensions: ["torrent"] }],
    });
    if (!selected) return;
    setLoading(true);
    setError("");
    try {
      const bytes = await readFile(selected as string);
      const result = await torrentsApi.addTorrentFile(Array.from(bytes));
      await torrentsApi.selectTorrentFiles(result.id, "all");
      onAdded();
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => { if (!o) onClose(); }}
      title="Add Torrent"
      description="Paste a magnet link or choose a .torrent file."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-torrent-form" disabled={loading || !magnet.trim()}>
            {loading ? "Adding..." : "Add"}
          </Button>
        </>
      }
    >
      <form
        id="add-torrent-form"
        className="flex flex-col gap-3"
        onSubmit={(e) => { e.preventDefault(); handleAddMagnet(); }}
      >
        <Input
          autoFocus
          value={magnet}
          onChange={(e) => setMagnet(e.target.value)}
          placeholder="magnet:?xt=urn:btih:..."
          aria-label="Magnet link"
          className="font-mono"
        />
        <div>
          <Button onClick={handleAddFile} disabled={loading}>
            Choose .torrent file…
          </Button>
        </div>
        {error && <p className="text-sm text-danger" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}

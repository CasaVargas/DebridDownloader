import { useEffect, useRef, useCallback } from "react";
import { subscribe } from "../api/transport";
import { getPendingMagnetUri } from "../api/magnet";

function parseMagnetDisplayName(uri: string): string | null {
  try {
    const match = uri.match(/[?&]dn=([^&]+)/);
    if (!match) return null;
    return decodeURIComponent(match[1].replace(/\+/g, " "));
  } catch {
    return null;
  }
}

interface MagnetLinkEvent {
  uri: string;
  displayName: string | null;
}

export function useMagnetLinkListener(
  onMagnetLink: (event: MagnetLinkEvent) => void,
  isAuthenticated: boolean
) {
  const currentUriRef = useRef<string | null>(null);

  const handleMagnetUri = useCallback(
    (uri: string) => {
      if (!isAuthenticated) {
        console.warn("Magnet link received but user is not authenticated");
        return;
      }
      if (currentUriRef.current === uri) {
        return;
      }
      currentUriRef.current = uri;
      const displayName = parseMagnetDisplayName(uri);
      onMagnetLink({ uri, displayName });
    },
    [isAuthenticated, onMagnetLink]
  );

  const clearCurrentUri = useCallback(() => {
    currentUriRef.current = null;
  }, []);

  useEffect(() => {
    const unlisten = subscribe<string>("magnet-link-received", (uri) => {
      handleMagnetUri(uri);
    });

    getPendingMagnetUri().then((uri) => {
      if (uri) {
        handleMagnetUri(uri);
      }
    }).catch(() => {});

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [handleMagnetUri]);

  return { clearCurrentUri };
}

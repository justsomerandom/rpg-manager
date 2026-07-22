import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type CloseGuardOptions = {
  active: boolean;
  confirmMessage: string;
  pending?: boolean;
  pendingMessage?: string;
  interactive?: boolean;
};

export type CloseGuardRequest = {
  kind: "confirm" | "pending" | "notice";
  message: string;
};

type CloseGuardController = {
  closeRequest: CloseGuardRequest | null;
  dismissCloseRequest: () => void;
  confirmCloseRequest: () => Promise<void>;
};

const isTauriRuntime = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

/**
 * Protects drafts from both browser unloads and Tauri's native window close button.
 * Tauri listener setup is skipped in ordinary browser development and failures fall
 * back to the browser unload guard.
 */
export function useCloseGuard({
  active,
  confirmMessage,
  pending = false,
  pendingMessage = "A change is still in progress. Wait for it to finish before closing the app.",
  interactive = false,
}: CloseGuardOptions): CloseGuardController {
  const allowCloseRef = useRef(false);
  const [closeRequest, setCloseRequest] = useState<CloseGuardRequest | null>(null);

  useEffect(() => {
    if (!active || (closeRequest?.kind === "pending" && !pending)) {
      setCloseRequest(null);
    }
  }, [active, closeRequest?.kind, pending]);

  useEffect(() => {
    allowCloseRef.current = false;
    if (!active || typeof window === "undefined") return;

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowCloseRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);

    let disposed = false;
    let unlisten: (() => void) | undefined;

    if (isTauriRuntime()) {
      void getCurrentWindow()
        .onCloseRequested((event) => {
          if (allowCloseRef.current) return;
          if (pending) {
            event.preventDefault();
            if (interactive) setCloseRequest({ kind: "pending", message: pendingMessage });
            else window.alert(pendingMessage);
            return;
          }

          if (interactive) {
            event.preventDefault();
            setCloseRequest({ kind: "confirm", message: confirmMessage });
            return;
          }

          if (!window.confirm(confirmMessage)) {
            event.preventDefault();
            return;
          }

          // A confirmed Tauri close should not trigger a second browser prompt.
          allowCloseRef.current = true;
        })
        .then((removeListener) => {
          if (disposed) removeListener();
          else unlisten = removeListener;
        })
        .catch(() => {
          // Browser beforeunload remains active if native listener setup is unavailable.
        });
    }

    return () => {
      disposed = true;
      window.removeEventListener("beforeunload", handleBeforeUnload);
      unlisten?.();
    };
  }, [active, confirmMessage, interactive, pending, pendingMessage]);

  const dismissCloseRequest = useCallback(() => setCloseRequest(null), []);

  const confirmCloseRequest = useCallback(async () => {
    if (closeRequest?.kind !== "confirm") return;
    allowCloseRef.current = true;
    setCloseRequest(null);
    try {
      await getCurrentWindow().close();
    } catch {
      allowCloseRef.current = false;
      setCloseRequest({
        kind: "notice",
        message: "The application could not close. Keep working and try again.",
      });
    }
  }, [closeRequest?.kind]);

  return { closeRequest, dismissCloseRequest, confirmCloseRequest };
}

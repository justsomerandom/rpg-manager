import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

type CloseGuardOptions = {
  active: boolean;
  confirmMessage: string;
  pending?: boolean;
  pendingMessage?: string;
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
}: CloseGuardOptions) {
  const allowCloseRef = useRef(false);

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
          if (pending) {
            event.preventDefault();
            window.alert(pendingMessage);
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
  }, [active, confirmMessage, pending, pendingMessage]);
}

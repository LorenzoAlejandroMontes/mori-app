// The one place that knows whether Mori is running on a Mac. Everything that
// reads differently there (the key labels, the default shortcut, "PC" in the
// interface text) asks here, so no view carries a platform check of its own.
// Pure: no React, no Tauri. Every function takes `mac` so the checks can ask
// for both answers on any machine.

function detectMac(): boolean {
  try {
    return /Mac|iPhone|iPad/i.test(`${navigator.platform ?? ""} ${navigator.userAgent ?? ""}`);
  } catch {
    return false; // no navigator (an old Node in the checks)
  }
}

let _mac = detectMac();

export function isMac(): boolean {
  return _mac;
}

/** For the checks: decide the platform without a Mac. */
export function usePlatformNow(mac: boolean): void {
  _mac = mac;
}

/** The global shortcut a new install starts with. It must match DEFAULT_HOTKEY in companion.rs. */
export function defaultHotkey(mac = _mac): string {
  return mac ? "Cmd+Shift+R" : "Ctrl+Shift+R";
}

/** The key that goes with K, J, S, Z…: Command on a Mac, Ctrl everywhere else. */
export function modKey(mac = _mac): string {
  return mac ? "⌘" : "Ctrl";
}

/** "Ctrl K" on Windows, "⌘K" on a Mac: the way each writes a combination. */
export function combo(key: string, mac = _mac): string {
  return mac ? `⌘${key}` : `Ctrl ${key}`;
}

/**
 * The interface text as it reads on this computer. The dictionary is written
 * once, for Windows ("Ctrl K", "on your PC", "the tray"); on a Mac the same
 * sentences name the Mac's things. Unchanged everywhere else.
 */
export function platformText(s: string, mac = _mac): string {
  if (!mac) return s;
  return s
    .replace(/\bCtrl[ +]/g, "⌘")
    .replace(/\bPC\b/g, "Mac")
    .replace(/\bWindows'(?=\s)/g, "macOS's")
    .replace(/\bWindows\b/g, "macOS")
    .replace(/\btray menu\b/g, "menu bar")
    .replace(/\btray\b/g, "menu bar");
}

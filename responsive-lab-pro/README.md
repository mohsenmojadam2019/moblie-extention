# Responsive Lab Pro — Chrome Extension (MV3)

افزونه حرفه‌ای Chrome برای تست ریسپانسیو و ویرایش زنده CSS در همان تب سایت، بدون iframe یا وابستگی خارجی.

## Features

- **Viewport emulation** using Chrome Debugger Protocol: viewport dimensions, DPR, touch, user agent, portrait/landscape. 17 built-in mobile, foldable, tablet and desktop presets plus custom dimensions.
- **Side panel inspector**: point-and-click DOM selection, selector and computed styles, live CSS editing, undo/reset, persistent per-origin CSS overrides, CSS export.
- **Responsive audit**: viewport meta, horizontal overflow, off-screen elements, small tap targets and potentially clipped text, with selector-based findings.
- **8-width sweep** for 320, 360, 375, 390, 414, 768, 1024 and 1280 CSS pixels; JSON export and PNG screenshot.
- **Privacy**: no telemetry, remote APIs, third-party scripts or build step. Settings saved only to `chrome.storage.local`.

## Install (Google Chrome 116+)

1. Download/clone the repository, then open `chrome://extensions`.
2. Enable **Developer mode** at the top right.
3. Click **Load unpacked** and select the folder containing `manifest.json`.
4. Pin **Responsive Lab Pro** and click its icon to open the side panel.
5. Open an ordinary HTTP/HTTPS page; select a device, press **فعال‌سازی / اعمال**. Use the built-in element picker in **اینسپکت CSS** to edit styles.
6. Run **بررسی عرض فعلی** or **اسکن ۸ عرض متداول** to identify responsive anomalies.

> Chrome doesn't allow extensions to silently install themselves. Users must confirm the unpacked extension in `chrome://extensions`.

## Key limitations

- **Debugger exclusivity**: Chrome's native DevTools and `chrome.debugger` cannot attach to the same target simultaneously. Close native DevTools while device emulation is active. This extension supplies its own side-panel inspector to avoid that conflict.
- **Engine fidelity**: iOS presets spoof dimensions and user agent but still render in Chromium; use Safari/iOS for Safari-specific bugs. Desktop profiles simulate dimensions only.
- **Chrome restricted pages**: Chrome Web Store, `chrome://` and other browser-internal pages are unavailable.
- **Nested cross-origin frames and shadow DOM**: the picker/audit primarily inspect the top document; selectors for dynamic DOM may need adjusting.
- **Heuristic audit**: findings are potential issues, not proof of broken layout. Confirm visually.
- For persisted per-site rules, **refresh the site** after saving to reapply rules to all matching elements. Files on the website/server are not modified.

## Validation

```bash
node tests/check.mjs
```

This checks manifest structure, device presets, messaging cases, browser compatibility, and the basic UI wiring. Then use manual smoke tests with `chrome://extensions` on a reachable local browser.

## Repository contents

`manifest.json` extension permissions/entrypoints; `background.js` emulation, screenshots and sweep; `content.js` picker, CSS editing and audit; `panel.*` interface; `devices.js` device catalog; `icons/` extension icons; `tests/` static checks.

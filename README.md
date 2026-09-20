# ELIX

Browser extension that explains highlighted text at a chosen level — like you're 5, 10, 15, 20, or a freeform age/style.

## Status

Working Manifest V3 prototype: selection overlay + BYOK OpenAI call from the service worker.

## Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`ELIX`)
5. Open the extension’s **Options** page and paste your OpenAI API key
6. Highlight text on any normal webpage, click **ELIX**, and pick a level in the overlay

Clicking the toolbar icon also opens Options.

## How it works

1. Content script watches for text selection, shows an ELIX chip (placed to avoid other highlight menus), and opens a shadow-DOM overlay when you click it
2. Choosing a level sends the selected text to the background service worker
3. Service worker calls OpenAI Chat Completions with your stored key
4. Explanation is returned into the overlay

## Notes

- Start on ordinary HTML pages; Google Docs / PDFs / some iframes are harder
- Key is stored in `chrome.storage.sync` and used only in the service worker
- `base URL` can point at an OpenAI-compatible endpoint if you change `host_permissions` in `manifest.json` to match

# ELIX (alpha preview)

A browser extension to look up anything in situ by simply highlighting text and selecting your complexity level: explain like I'm 5, 10, 15, 20, or input your own persona.

## Status

Working Manifest V3 BYOK prototype.

## Chromium Alpha Test

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`ELIX`)
5. Open the extension’s **Options** page and paste your OpenAI API key
6. Highlight text on any normal webpage and click **ELIX** — it explains at your default level (5, unless you change it in Options)
7. Hover over an image, video, or canvas, click **ELIX**, and drag a rectangle over the frozen screenshot to explain that region. Press Escape to cancel; very small selections can be redrawn.

After updating an existing installation, reload the extension and the webpage. This version requests `<all_urls>` host access so the in-page button can capture the visible tab. Only the selected crop is sent to the configured API; the full screenshot stays local and is discarded after cropping. Your configured model must support image input.

## How it works

1. Content script watches for text selection, shows an ELIX chip (placed to avoid other highlight menus), and opens a shadow-DOM overlay when you click it
2. The overlay starts generating at the default level (5 unless changed in Options); picking another level there sends the selected text to the background service worker
3. Service worker calls OpenAI Chat Completions with your stored key
4. Explanation is returned into the overlay

## Landing page preview

The landing page also includes a limited highlight-to-explain preview. Run it
with a server-side key so the key is never sent to the browser:

```sh
OPENAI_API_KEY=your-key node server.js
```

Then open `http://localhost:4173`, highlight text in the page, and click
**Explain selection**. The preview accepts up to 280 selected characters.

## Known limitations

The chip only appears when the page exposes a normal HTML selection (`window.getSelection()` and a DOM range).

- **PDFs.** Chrome shows these in its built-in viewer, an internal extension page. ELIX's content script is not injected there, so a highlight never produces a chip. That includes local `file://` files.
- **Google Docs.** The script does load on `docs.google.com`, but the document is drawn on a canvas and the selection belongs to Docs. The page selection stays empty, and the editor's text target sits in an iframe this script does not enter.
- **Other iframes.** The content script runs in the top frame only. A highlight inside an embedded frame is not visible to it.
- **Video.** Capture explains one visible frame, not the clip or its audio. Protected video may appear black in screenshots. Embedded players inside iframes, native fullscreen players, and CSS background images do not currently expose the hover button.
- **Code blocks.** A `<pre>` / `<code>` block scrolls on its own. Highlighting text scrolls that box, and the content script treats every scroll as the page moving, so it clears the chip before the chip can appear.

## Notes

- Key is stored in `chrome.storage.sync` and used only in the service worker
- `base URL` can point at an OpenAI-compatible endpoint; image explanations require support for Chat Completions image inputs

## Capture Checks

With Node.js and Playwright installed, run `node tests/media-capture.cjs` for browser interaction and request checks. These use mocked Chrome APIs and never send an API request. Actual Chrome permission grants and protected video capture still need a manual extension smoke test.

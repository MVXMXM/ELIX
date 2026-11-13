# ELIX (alpha preview)

A browser extension to look up anything in situ by simply highlighting text and selecting your complexity level: explain like I'm 5, 10, 15, 20, or input your own persona.

## Status

Working Manifest V3 BYOK prototype.

## Chromium Alpha Test

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`ELIX`)
5. Highlight text on any normal webpage and click **ELIX**. The gear holds the API key, model, and image capture. The first visit asks for the key there.
6. It explains at the saved level (5 until you pick another age or persona). That choice is remembered.
7. Turn on **Images** from the gear to explain a region of an image, video, or canvas. Hover the media, click **ELIX**, and drag a rectangle over the frozen screenshot. Press Escape to cancel; very small selections can be redrawn.

After updating an existing installation, reload the extension and the webpage. This version requests `<all_urls>` host access so the in-page button can capture the visible tab. Only the selected crop is sent to OpenAI; the full screenshot stays local and is discarded after cropping. The model list is limited to recent models that accept text and images.

## How it works

1. Content script watches for text selection, shows an ELIX chip (placed to avoid other highlight menus), and opens a shadow-DOM overlay when you click it
2. The overlay starts generating at the saved level (5 until you pick another); picking another level saves it and sends the selected text to the background service worker
3. Service worker calls OpenAI Chat Completions with your stored key
4. Explanation is returned into the overlay

## Known limitations

The chip only appears when the page exposes a normal HTML selection (`window.getSelection()` and a DOM range).

- **PDFs.** Chrome shows these in its built-in viewer, an internal extension page. ELIX's content script is not injected there, so a highlight never produces a chip. That includes local `file://` files.
- **Google Docs.** The script does load on `docs.google.com`, but the document is drawn on a canvas and the selection belongs to Docs. The page selection stays empty, and the editor's text target sits in an iframe this script does not enter.
- **Other iframes.** The content script runs in the top frame only. A highlight inside an embedded frame is not visible to it.
- **Video.** Capture explains one visible frame, not the clip or its audio. Protected video may appear black in screenshots. Embedded players inside iframes, native fullscreen players, and CSS background images do not currently expose the hover button.
- **Code blocks.** A `<pre>` / `<code>` block scrolls on its own. Highlighting text scrolls that box, and the content script treats every scroll as the page moving, so it clears the chip before the chip can appear.

## Notes

- Key is stored in `chrome.storage.sync` and used only in the service worker
- Explanations are sent to OpenAI Chat Completions

## Capture Checks

With Node.js and Playwright installed, run `node tests/media-capture.cjs` for browser interaction and request checks. These use mocked Chrome APIs and never send an API request. Actual Chrome permission grants and protected video capture still need a manual extension smoke test.

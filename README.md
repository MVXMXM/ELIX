# ELIX (Explain Like I'm X)

Explain anything without interrupting your flow. Simply highlight something on screen for an in-situ explanation, tailored to your mind. Calibrate explanation complexity with cues like age, e.g. ELI5 (explain like I'm 5), or any persona you choose, e.g. a physicist, a French guy, or even a cat.

## Origin

The idea came from Rauno Freiberg’s [inline word definition lookup](https://x.com/MVXMXM/status/1752330736055579071?s=20) prototype. I loved the UX of augmenting intellect without breaking flow. By contrast, when reading online, I persistently tabbed to a chatbot to ask what something meant, which takes seven steps each time (highlight text → cmd + c → switch to chatbot tab → type “ELI5” → cmd + p → enter → return to original tab). ELIX consolidates this into two steps (originally I tried just one, but it was a step too far).

## Design Decisions

ELIX automates the flow described above by taking your highlighted content & packaging it with a pre-written prompt. Clicking the in-page ELIX button sends the selected content to the model and streams the response into the page.

Instead of definitions, as Rauno’s prototype depicted, ELIX responds with explanations. This is because it solves for circumstances seeking useful understanding, which may not always be technically correct. Revolving the experience around the youthful presets (”explain like I’m 5, 10, 15, 20”) & the freeform input’s playful placeholders (”explain like I’m a cat”) reinforce the notion that responses are heuristics, not expert-level definition. As Nassim Taleb explains in Antifragile:

> “Heuristics are simplified rules of thumb that make things simple and easy to implement. But their main advantage is that the user knows that they are not perfect, just expedient, and is therefore less fooled by their powers. They become dangerous when we forget that.”
> 

Imagine an average person comes across a mention of cryogenic propellant transfer while reading an article about SpaceX. Quickly getting the gist of the concept will help them through the article, without any illusion that they’re not a rocket scientist (as in, without fully *grokking* it — sorry, had to).

ELIX helps us act under uncertainty, without eliminating it entirely.

## Chromium Alpha Testing

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this folder (`ELIX`)
5. Open **ELIX** in the Chrome toolbar and click **Add an API key**. In the ELIX tab, enter your key, confirm the data disclosure, then click **Add my key**. Highlight text on any normal webpage and click the in-page **ELIX** button.
6. It explains at the saved level (5 until you pick another age or persona). That choice is remembered.
7. To explain a region of an image, video, or canvas, open **Settings** in the toolbar popup and turn on **Media input (alpha)**. Hover over the media, click **ELIX**, and drag a rectangle over the frozen screenshot. Press Escape to cancel; very small selections can be redrawn.

After updating an existing installation, reload the extension and the webpage. This version requests `<all_urls>` host access so the in-page button can capture the visible tab. Only the selected crop is sent to OpenAI; the full screenshot stays local and is discarded after cropping. The model list is limited to recent models that accept text and images.

## Known limitations

The chip only appears when the page exposes a normal HTML selection (`window.getSelection()` and a DOM range).

- **PDFs.** Chrome shows these in its built-in viewer, an internal extension page. ELIX's content script is not injected there, so a highlight never produces a chip. That includes local `file://` files.
- **Google Docs.** The script does load on `docs.google.com`, but the document is drawn on a canvas and the selection belongs to Docs. The page selection stays empty, and the editor's text target sits in an iframe this script does not enter.
- **Other iframes.** The content script runs in the top frame only. A highlight inside an embedded frame is not visible to it.
- **Video.** Capture explains one visible frame, not the clip or its audio. Protected video may appear black in screenshots. Embedded players inside iframes, native fullscreen players, and CSS background images do not currently expose the hover button.
- **Code blocks.** A `<pre>` / `<code>` block scrolls on its own. Highlighting text scrolls that box, and the content script treats every scroll as the page moving, so it clears the chip before the chip can appear.

## Notes

- The API key is stored in `chrome.storage.sync`. Enter or edit it in the dedicated ELIX tab. The in-page settings display only a masked abbreviation, and the service worker sends API requests.
- Explanations are sent to OpenAI Chat Completions

## Chrome Web Store build

Run `npm ci`, then `npm run package:chrome` to create the upload ZIP under `build/releases/`. Test the extracted ZIP in a clean Chrome profile before uploading it to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).

Before submitting, publish the [privacy policy](https://elix.fyi/privacy.html), prepare store screenshots and reviewer instructions, and verify that the permission declarations match the packaged build. The Chrome build uses access to HTTP and HTTPS pages to show the selection control. It requests `<all_urls>` host access for the opt-in screenshot flow that starts from the in-page ELIX button.

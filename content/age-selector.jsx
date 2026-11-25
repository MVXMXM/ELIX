import { LLMLoader, SegmentedController } from "@mvxmxm/maxos";
import styles from "@mvxmxm/maxos/segmented-controller.css";
import loaderStyles from "@mvxmxm/maxos/llm-loader.css";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";

import archivo from "./fonts/archivo-latin.woff2";
import inter from "./fonts/inter-latin.woff2";

document.fonts.add(new FontFace("ELIX Archivo", archivo, { weight: "100 900" }));
document.fonts.add(new FontFace("ELIX Inter", inter, { weight: "100 900" }));

export function mount(container, levels, onChange) {
  const sheet = document.createElement("style");
  sheet.textContent = styles + "\n" + loaderStyles;
  container.getRootNode().appendChild(sheet);

  const items = levels.map(level => ({ id: level, label: level }));
  const root = createRoot(container);

  return function render(value, persona, expanded) {
    const label = <span className="persona-segment-label">{persona || "Other"}</span>;
    const options = [...items, { id: "other", label, expanded }];
    flushSync(() => {
      root.render(
        <SegmentedController label="Explanation age" items={options} value={value} onChange={onChange} />
      );
    });
    const other = container.querySelector("button[aria-expanded]");
    if (persona) other.title = persona;
    else other.removeAttribute("title");
  };
}
export function mountLoader(container) {
  const root = createRoot(container);
  flushSync(() => root.render(<LLMLoader />));
}

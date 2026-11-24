const component = location.pathname.split("/").at(-1).replace(/\.html$/, "");
const selectors = {
  wordmark: "h1",
  description: ".description",
  alpha: ".button",
  chip: ".description",
  overlay: ".description",
  settings: ".description",
};

const response = await fetch("/index.html");
if (!response.ok) throw new Error("Could not load the ELIX landing page.");
const landing = new DOMParser().parseFromString(await response.text(), "text/html");

for (const style of landing.head.querySelectorAll('style, link[rel="stylesheet"]')) {
  document.head.append(style);
}

const main = document.createElement("main");
const sample = landing.querySelector(selectors[component]);
const interactive = component === "chip" || component === "overlay" || component === "settings";

main.append(sample);
document.body.append(main);
main.style.marginBottom = "0";
document.body.style.padding = "12px";

if (interactive) {
  main.hidden = component === "settings";
  document.body.style.placeItems = "start center";
  main.style.marginTop = "8px";

  const demo = document.createElement("script");
  demo.src = "/content/content.js";
  demo.dataset.elixDemo = sample.id;
  demo.dataset.elixPreview = component;
  document.body.append(demo);
}

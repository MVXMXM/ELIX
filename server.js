const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 4173);
const apiKey = process.env.OPENAI_API_KEY;
const root = __dirname;
const mimeTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
};

async function explain(text) {
  if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0.4,
      messages: [
        {
          role: "user",
          content:
            "Define the highlighted text in one or two succinct sentences. Use plain language calibrated for a general reader. Return only the definition, with no markdown or preface.\n\nHighlighted text:\n" +
            text,
        },
      ],
    }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "OpenAI request failed.");
  return data.choices?.[0]?.message?.content?.trim() || "No explanation was returned.";
}

const server = http.createServer(async (request, response) => {
  if (request.method === "POST" && request.url === "/api/explain") {
    let body = "";
    for await (const chunk of request) body += chunk;
    try {
      const text = JSON.parse(body).text?.trim();
      if (!text || text.length > 280) throw new Error("Select up to 280 characters.");
      const explanation = await explain(text);
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ explanation }));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const requested = request.url === "/" ? "/index.html" : request.url.split("?")[0];
  const filePath = path.resolve(root, `.${requested}`);
  if (!filePath.startsWith(`${root}${path.sep}`) || !fs.existsSync(filePath)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": mimeTypes[path.extname(filePath)] || "text/plain; charset=utf-8",
  });
  fs.createReadStream(filePath).pipe(response);
});

server.listen(port, () => {
  console.log(`ELIX preview running at http://localhost:${port}`);
});

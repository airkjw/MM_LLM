import { readFile, writeFile } from "node:fs/promises";
import { Resvg } from "@resvg/resvg-js";

const svg = await readFile(new URL("../resources/icon.svg", import.meta.url), "utf8");
const rendered = new Resvg(svg, { fitTo: { mode: "width", value: 1024 } }).render();
await writeFile(new URL("../resources/icon.png", import.meta.url), rendered.asPng());

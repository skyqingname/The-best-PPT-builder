import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { buildPptx } from "../src/lib/export-pptx.ts";

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1280 720" width="1280" height="720"><rect width="1280" height="720" fill="#fff"/><text x="80" y="120">PPT Agent</text></svg>`;

test("PPTX export contains ordered slides with SVG and PNG fallback", async () => {
  const buffer = await buildPptx([svg, svg.replace("PPT Agent", "Page 2")]);
  const zip = await JSZip.loadAsync(buffer);

  assert.ok(zip.file("ppt/slides/slide1.xml"));
  assert.ok(zip.file("ppt/slides/slide2.xml"));
  assert.ok(zip.file("ppt/media/image1.svg"));
  assert.ok(zip.file("ppt/media/image1.png"));
  assert.ok(zip.file("ppt/media/image2.svg"));
  assert.ok(zip.file("ppt/media/image2.png"));

  const presentation = await zip.file("ppt/presentation.xml")?.async("string");
  assert.match(presentation ?? "", /rId2/);
  assert.match(presentation ?? "", /rId3/);
});

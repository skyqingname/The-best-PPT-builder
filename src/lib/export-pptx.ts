import { Resvg } from "@resvg/resvg-js";
import JSZip from "jszip";

const SLIDE_CX = 12192000;
const SLIDE_CY = 6858000;

function contentTypesXml(count: number): string {
  const overrides = Array.from({ length: count }, (_, index) => {
    const n = index + 1;
    return `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>
<Override PartName="/ppt/media/image${n}.svg" ContentType="image/svg+xml"/>
<Override PartName="/ppt/media/image${n}.png" ContentType="image/png"/>`;
  }).join("\n");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Default Extension="svg" ContentType="image/svg+xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
  ${overrides}
</Types>`;
}

function relsRoot(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/>
</Relationships>`;
}

function presentationXml(count: number): string {
  const ids = Array.from(
    { length: count },
    (_, index) => `<p:sldId id="${256 + index}" r:id="rId${index + 2}"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">
  <p:sldIdLst>${ids}</p:sldIdLst>
  <p:sldSz cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>
  <p:notesSz cx="6858000" cy="9144000"/>
</p:presentation>`;
}

function presentationRels(count: number): string {
  const slides = Array.from(
    { length: count },
    (_, index) =>
      `<Relationship Id="rId${index + 2}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${index + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${slides}
</Relationships>`;
}

function slideXml(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:asvg="http://schemas.microsoft.com/office/drawing/2016/SVG/main">
  <p:cSld>
    <p:spTree>
      <p:nvGrpSpPr>
        <p:cNvPr id="1" name=""/>
        <p:cNvGrpSpPr/>
        <p:nvPr/>
      </p:nvGrpSpPr>
      <p:grpSpPr>
        <a:xfrm>
          <a:off x="0" y="0"/>
          <a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>
          <a:chOff x="0" y="0"/>
          <a:chExt cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>
        </a:xfrm>
      </p:grpSpPr>
      <p:pic>
        <p:nvPicPr>
          <p:cNvPr id="2" name="Slide"/>
          <p:cNvPicPr>
            <a:picLocks noChangeAspect="1"/>
          </p:cNvPicPr>
          <p:nvPr/>
        </p:nvPicPr>
        <p:blipFill>
          <a:blip r:embed="rId1">
            <a:extLst>
              <a:ext uri="{96DAC541-7B7A-43D3-8B79-37D633B846F1}">
                <asvg:svgBlip r:embed="rId2"/>
              </a:ext>
            </a:extLst>
          </a:blip>
          <a:stretch>
            <a:fillRect/>
          </a:stretch>
        </p:blipFill>
        <p:spPr>
          <a:xfrm>
            <a:off x="0" y="0"/>
            <a:ext cx="${SLIDE_CX}" cy="${SLIDE_CY}"/>
          </a:xfrm>
          <a:prstGeom prst="rect">
            <a:avLst/>
          </a:prstGeom>
        </p:spPr>
      </p:pic>
    </p:spTree>
  </p:cSld>
  <p:clrMapOvr>
    <a:masterClrMapping/>
  </p:clrMapOvr>
</p:sld>`;
}

function slideRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/imagePLACE.png"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="../media/imagePLACE.svg"/>
</Relationships>`;
}

function svgToPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: 1920 },
    font: { loadSystemFonts: true },
    background: "white",
  });
  return Buffer.from(resvg.render().asPng());
}

export async function buildPptx(svgs: string[]): Promise<Buffer> {
  if (svgs.length === 0) {
    throw new Error("没有可导出的设计稿");
  }
  const zip = new JSZip();
  zip.file("[Content_Types].xml", contentTypesXml(svgs.length));
  zip.folder("_rels")?.file(".rels", relsRoot());
  const ppt = zip.folder("ppt");
  ppt?.file("presentation.xml", presentationXml(svgs.length));
  ppt?.folder("_rels")?.file("presentation.xml.rels", presentationRels(svgs.length));
  const slides = ppt?.folder("slides");
  const slideRelsDir = slides?.folder("_rels");
  const media = ppt?.folder("media");

  svgs.forEach((svg, index) => {
    const n = index + 1;
    slides?.file(`slide${n}.xml`, slideXml());
    slideRelsDir?.file(
      `slide${n}.xml.rels`,
      slideRels().replaceAll("imagePLACE", `image${n}`),
    );
    media?.file(`image${n}.svg`, svg);
    media?.file(`image${n}.png`, svgToPng(svg));
  });

  return zip.generateAsync({ type: "nodebuffer" });
}

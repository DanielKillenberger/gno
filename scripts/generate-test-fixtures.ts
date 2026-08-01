#!/usr/bin/env bun

/**
 * Generate test fixtures for document conversion tests.
 * Creates real PDF, DOCX, XLSX, PPTX files with known content.
 *
 * Run: bun scripts/generate-test-fixtures.ts
 */

import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import ExcelJS from "exceljs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import PptxGenJS from "pptxgenjs";

const FIXTURES_DIR = join(import.meta.dir, "../test/fixtures/conversion");

// ─────────────────────────────────────────────────────────────────────────────
// PDF Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function generatePdf(): Promise<void> {
  const pdfDoc = await PDFDocument.create();
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const page = pdfDoc.addPage([612, 792]); // Letter size
  const { height } = page.getSize();

  // Title
  page.drawText("GNO Test Document", {
    x: 50,
    y: height - 50,
    size: 24,
    font: boldFont,
    color: rgb(0, 0, 0),
  });

  // Subtitle
  page.drawText("PDF Conversion Test Fixture", {
    x: 50,
    y: height - 80,
    size: 14,
    font,
    color: rgb(0.3, 0.3, 0.3),
  });

  // Body content
  const bodyText = [
    "This document tests PDF-to-Markdown conversion.",
    "",
    "Key Features:",
    "• Text extraction from PDF pages",
    "• Handling of different font styles",
    "• Multi-line paragraph support",
    "",
    "The quick brown fox jumps over the lazy dog.",
    "Pack my box with five dozen liquor jugs.",
  ];

  let y = height - 120;
  for (const line of bodyText) {
    page.drawText(line, {
      x: 50,
      y,
      size: 12,
      font,
      color: rgb(0, 0, 0),
    });
    y -= 18;
  }

  const pdfBytes = await pdfDoc.save();
  await mkdir(join(FIXTURES_DIR, "pdf"), { recursive: true });
  await writeFile(join(FIXTURES_DIR, "pdf/sample.pdf"), pdfBytes);
  console.log("✓ Generated pdf/sample.pdf");
}

// ─────────────────────────────────────────────────────────────────────────────
// DOCX Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function generateDocx(): Promise<void> {
  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: "GNO Test Document",
            heading: HeadingLevel.HEADING_1,
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "This document tests DOCX-to-Markdown conversion.",
              }),
            ],
          }),
          new Paragraph({
            text: "Features",
            heading: HeadingLevel.HEADING_2,
          }),
          new Paragraph({
            children: [
              new TextRun({ text: "Bold text", bold: true }),
              new TextRun({ text: " and " }),
              new TextRun({ text: "italic text", italics: true }),
              new TextRun({ text: " are supported." }),
            ],
          }),
          new Paragraph({
            text: "Tables",
            heading: HeadingLevel.HEADING_2,
          }),
          new Table({
            rows: [
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph("Name")],
                  }),
                  new TableCell({
                    children: [new Paragraph("Value")],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph("Alpha")],
                  }),
                  new TableCell({
                    children: [new Paragraph("100")],
                  }),
                ],
              }),
              new TableRow({
                children: [
                  new TableCell({
                    children: [new Paragraph("Beta")],
                  }),
                  new TableCell({
                    children: [new Paragraph("200")],
                  }),
                ],
              }),
            ],
          }),
          new Paragraph({
            text: "",
          }),
          new Paragraph({
            children: [
              new TextRun({
                text: "The quick brown fox jumps over the lazy dog.",
              }),
            ],
          }),
        ],
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);
  await mkdir(join(FIXTURES_DIR, "docx"), { recursive: true });
  await writeFile(join(FIXTURES_DIR, "docx/sample.docx"), buffer);
  console.log("✓ Generated docx/sample.docx");
}

// ─────────────────────────────────────────────────────────────────────────────
// XLSX Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function generateXlsx(): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "GNO Test";
  workbook.created = new Date(2025, 0, 1);

  // Sheet 1: Sales Data
  const sheet1 = workbook.addWorksheet("Sales Data");
  sheet1.columns = [
    { header: "Product", key: "product", width: 20 },
    { header: "Q1", key: "q1", width: 10 },
    { header: "Q2", key: "q2", width: 10 },
    { header: "Q3", key: "q3", width: 10 },
    { header: "Q4", key: "q4", width: 10 },
    { header: "Total", key: "total", width: 12 },
  ];

  sheet1.addRows([
    { product: "Widget A", q1: 100, q2: 150, q3: 200, q4: 180, total: 630 },
    { product: "Widget B", q1: 80, q2: 90, q3: 110, q4: 120, total: 400 },
    { product: "Gadget X", q1: 200, q2: 220, q3: 190, q4: 250, total: 860 },
  ]);

  // Sheet 2: Metadata
  const sheet2 = workbook.addWorksheet("Metadata");
  sheet2.addRows([
    ["Key", "Value"],
    ["Version", "1.0"],
    ["Author", "GNO Test Suite"],
    ["Purpose", "XLSX conversion testing"],
  ]);

  await mkdir(join(FIXTURES_DIR, "xlsx"), { recursive: true });
  await workbook.xlsx.writeFile(join(FIXTURES_DIR, "xlsx/sample.xlsx"));
  console.log("✓ Generated xlsx/sample.xlsx");
}

// ─────────────────────────────────────────────────────────────────────────────
// PPTX Fixture
// ─────────────────────────────────────────────────────────────────────────────

async function generatePptx(): Promise<void> {
  const pptx = new PptxGenJS();
  pptx.author = "GNO Test Suite";
  pptx.title = "GNO Test Presentation";
  pptx.subject = "PPTX Conversion Testing";

  // Slide 1: Title slide
  const slide1 = pptx.addSlide();
  slide1.addText("GNO Test Presentation", {
    x: 0.5,
    y: 2,
    w: "90%",
    h: 1,
    fontSize: 36,
    bold: true,
    align: "center",
  });
  slide1.addText("Testing PPTX-to-Markdown Conversion", {
    x: 0.5,
    y: 3.2,
    w: "90%",
    h: 0.5,
    fontSize: 18,
    align: "center",
    color: "666666",
  });

  // Slide 2: Content slide
  const slide2 = pptx.addSlide();
  slide2.addText("Key Features", {
    x: 0.5,
    y: 0.5,
    w: "90%",
    h: 0.8,
    fontSize: 28,
    bold: true,
  });
  slide2.addText(
    [
      { text: "• Text extraction from slides\n", options: { fontSize: 18 } },
      { text: "• Speaker notes support\n", options: { fontSize: 18 } },
      { text: "• Multiple slide handling\n", options: { fontSize: 18 } },
      { text: "• Table extraction\n", options: { fontSize: 18 } },
    ],
    { x: 0.5, y: 1.5, w: "90%", h: 2 }
  );
  slide2.addNotes(
    "These are speaker notes for slide 2. They should be extracted."
  );

  // Slide 3: Table slide
  const slide3 = pptx.addSlide();
  slide3.addText("Data Table", {
    x: 0.5,
    y: 0.5,
    w: "90%",
    h: 0.8,
    fontSize: 28,
    bold: true,
  });
  slide3.addTable(
    [
      [
        { text: "Item", options: { bold: true } },
        { text: "Status", options: { bold: true } },
      ],
      [{ text: "Feature A" }, { text: "Complete" }],
      [{ text: "Feature B" }, { text: "In Progress" }],
      [{ text: "Feature C" }, { text: "Planned" }],
    ],
    { x: 0.5, y: 1.5, w: 6, colW: [3, 3] }
  );

  await mkdir(join(FIXTURES_DIR, "pptx"), { recursive: true });
  await pptx.writeFile({ fileName: join(FIXTURES_DIR, "pptx/sample.pptx") });
  console.log("✓ Generated pptx/sample.pptx");
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF fixtures for native viewer (fn-112)
//
// All checked-in fn-112 fixtures are hand-authored deterministic byte templates
// so isolated regeneration is exact byte-match. pdf-lib is used only for the
// on-demand large PDF generator (NOT checked in).
// ─────────────────────────────────────────────────────────────────────────────

const PDF_DIR = join(FIXTURES_DIR, "pdf");

/** Fixed creation epoch used nowhere in hand templates (documentation only). */
const FN112_FIXTURE_NAMES = [
  "viewer-links.pdf",
  "corrupt.pdf",
  "js-action.pdf",
  "standard-font.pdf",
  "cjk-cmap.pdf",
  "zero-page.pdf",
] as const;

/**
 * Build a deterministic PDF from numbered object bodies.
 * Object bodies must be complete `N 0 obj...endobj\n` strings without leading
 * offsets; xref is computed from UTF-8 byte lengths.
 */
function buildDeterministicPdf(objectBodies: string[]): string {
  let body = "%PDF-1.4\n";
  const offsets: number[] = [0];
  for (const obj of objectBodies) {
    offsets.push(Buffer.byteLength(body, "utf8"));
    body += obj;
  }
  const xrefStart = Buffer.byteLength(body, "utf8");
  const n = objectBodies.length;
  let xref = `xref\n0 ${n + 1}\n0000000000 65535 f \n`;
  for (let i = 1; i <= n; i++) {
    xref += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  }
  body += xref;
  body += `trailer<< /Size ${n + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;
  return body;
}

async function writePdfFixture(
  name: string,
  body: string | Uint8Array
): Promise<void> {
  await mkdir(PDF_DIR, { recursive: true });
  await writeFile(join(PDF_DIR, name), body);
  console.log(`✓ Generated pdf/${name}`);
}

/** On-demand large PDF generator for e2e (NOT checked in). */
export async function generateLargePdf(
  pages: number,
  outPath?: string
): Promise<Uint8Array> {
  // updateMetadata:false avoids wall-clock timestamps in Info dict
  const pdfDoc = await PDFDocument.create({ updateMetadata: false });
  pdfDoc.setCreationDate(new Date(Date.UTC(2020, 0, 1, 0, 0, 0)));
  pdfDoc.setModificationDate(new Date(Date.UTC(2020, 0, 1, 0, 0, 0)));
  pdfDoc.setProducer("gno-fn112-fixture");
  pdfDoc.setCreator("gno-fn112-fixture");
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const count = Math.max(1, pages);
  for (let i = 0; i < count; i++) {
    const page = pdfDoc.addPage([612, 792]);
    const { height } = page.getSize();
    page.drawText(`Large fixture page ${i + 1} of ${count}`, {
      x: 50,
      y: height - 50,
      size: 18,
      font,
      color: rgb(0, 0, 0),
    });
    page.drawText(
      "Deterministic content for virtualization and performance budgets.",
      {
        x: 50,
        y: height - 90,
        size: 12,
        font,
        color: rgb(0.2, 0.2, 0.2),
      }
    );
    page.drawText(`MARKER_PAGE_${i + 1}`, {
      x: 50,
      y: height - 130,
      size: 14,
      font,
      color: rgb(0, 0, 0),
    });
  }
  const bytes = await pdfDoc.save({
    useObjectStreams: false,
    addDefaultPage: false,
    updateFieldAppearances: false,
  });
  if (outPath) {
    await mkdir(join(outPath, ".."), { recursive: true }).catch(
      () => undefined
    );
    await writeFile(outPath, bytes);
  }
  return bytes;
}

/**
 * ~5-page fixture with selectable text, external https link, javascript: link,
 * and an internal GoTo destination. Pure hand-authored bytes (deterministic).
 */
async function generateViewerLinkFixture(): Promise<void> {
  const pageContents: string[] = [];
  for (let i = 1; i <= 5; i++) {
    const lines = [
      `BT /F1 20 Tf 50 742 Td (Viewer Link Fixture - Page ${i}) Tj ET`,
      `BT /F1 14 Tf 50 692 Td (KNOWN_GLYPH_RUN_ALPHA the quick brown fox) Tj ET`,
      `BT /F1 12 Tf 50 662 Td (Selectable text for alignment tests at multiple zooms.) Tj ET`,
    ];
    if (i === 1) {
      lines.push(
        `BT /F1 12 Tf 50 612 Td (External HTTPS link below \\(annotation\\).) Tj ET`,
        `BT /F1 12 Tf 50 572 Td (JavaScript link \\(must be inert\\).) Tj ET`,
        `BT /F1 12 Tf 50 532 Td (Internal jump to page 3.) Tj ET`
      );
    }
    if (i === 3) {
      lines.push(`BT /F1 16 Tf 50 632 Td (INTERNAL_DEST_PAGE_THREE) Tj ET`);
    }
    pageContents.push(lines.join("\n"));
  }

  // Object layout:
  // 1 Catalog, 2 Pages, 3-7 Page, 8-12 Contents, 13 Font, 14-16 Annots
  const contentObjs = pageContents.map((c, idx) => {
    const n = 8 + idx;
    const len = Buffer.byteLength(c, "utf8");
    return `${n} 0 obj<< /Length ${len} >>stream\n${c}\nendstream\nendobj\n`;
  });

  // Annotations reference page 3 (object 5) for GoTo
  const httpsAnnot =
    "14 0 obj<< /Type /Annot /Subtype /Link /Rect [50 592 280 622] /Border [0 0 1] /A << /Type /Action /S /URI /URI (https://example.com/gno-pdf-viewer) >> >>endobj\n";
  const jsAnnot =
    "15 0 obj<< /Type /Annot /Subtype /Link /Rect [50 552 280 582] /Border [0 0 1] /A << /Type /Action /S /URI /URI (javascript:alert\\('xss'\\)) >> >>endobj\n";
  const gotoAnnot =
    "16 0 obj<< /Type /Annot /Subtype /Link /Rect [50 512 280 542] /Border [0 0 1] /A << /Type /Action /S /GoTo /D [5 0 R /XYZ 0 792 null] >> >>endobj\n";

  const pageObjs: string[] = [];
  for (let i = 0; i < 5; i++) {
    const pageObjNum = 3 + i;
    const contentObjNum = 8 + i;
    const annots = i === 0 ? " /Annots [14 0 R 15 0 R 16 0 R]" : "";
    pageObjs.push(
      `${pageObjNum} 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${contentObjNum} 0 R /Resources << /Font << /F1 13 0 R >> >>${annots} >>endobj\n`
    );
  }

  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R 4 0 R 5 0 R 6 0 R 7 0 R] /Count 5 >>endobj\n",
    ...pageObjs,
    ...contentObjs,
    "13 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    httpsAnnot,
    jsAnnot,
    gotoAnnot,
  ];

  const body = buildDeterministicPdf(objects);
  await writePdfFixture("viewer-links.pdf", body);
}

/** Truncated valid PDF — corrupt fixture (deterministic). */
async function generateCorruptPdf(): Promise<void> {
  // Start from a minimal valid single-page PDF, then truncate after the header
  // so parsers recognize %PDF- but fail on structure.
  const full = buildDeterministicPdf([
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    "4 0 obj<< /Length 44 >>stream\nBT /F1 12 Tf 50 700 Td (truncated) Tj ET\nendstream\nendobj\n",
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ]);
  const truncated = Buffer.from(full, "utf8").subarray(0, 120);
  await writePdfFixture("corrupt.pdf", truncated);
}

/**
 * PDF with a real catalog /OpenAction whose action has /S /JavaScript and /JS.
 * Names-tree JavaScript alone is insufficient (I2-4).
 */
async function generateJsActionPdf(): Promise<void> {
  const content =
    "BT /F1 14 Tf 50 700 Td (JS OpenAction fixture - scripting must stay inert.) Tj ET";
  const contentLen = Buffer.byteLength(content, "utf8");
  const js = "app.alert('PDF embedded JS must not run');";
  // Catalog OpenAction → action dict with /S /JavaScript /JS
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R /OpenAction 6 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${contentLen} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
    `6 0 obj<< /Type /Action /S /JavaScript /JS (${js}) >>endobj\n`,
  ];
  const body = buildDeterministicPdf(objects);
  if (!body.includes("/OpenAction 6 0 R")) {
    throw new Error("js-action.pdf missing catalog /OpenAction");
  }
  if (!body.includes("/S /JavaScript") || !body.includes("/JS (")) {
    throw new Error("js-action.pdf missing JavaScript action dictionary");
  }
  await writePdfFixture("js-action.pdf", body);
}

/**
 * Standard 14 font reference with NO embedded FontFile stream.
 * Hand-authored so PDF.js must fetch from standardFontDataUrl.
 */
async function generateStandardFontPdf(): Promise<void> {
  const content =
    "BT /F1 24 Tf 50 700 Td (Standard Font Fixture HELVETICA) Tj ET";
  const contentLen = Buffer.byteLength(content, "utf8");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${contentLen} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n",
  ];
  const body = buildDeterministicPdf(objects);
  if (body.includes("FontFile")) {
    throw new Error("standard-font.pdf unexpectedly contains FontFile");
  }
  await writePdfFixture("standard-font.pdf", body);
}

/**
 * Minimal Type0 font with /Encoding /UniJIS-UCS2-H and non-embedded CID font
 * so PDF.js must fetch the packed cMap from cMapUrl.
 */
async function generateCjkCmapPdf(): Promise<void> {
  const content = "BT /F0 24 Tf 50 700 Td <004100420043> Tj ET";
  const contentLen = Buffer.byteLength(content, "utf8");
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
    "3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F0 5 0 R >> >> >>endobj\n",
    `4 0 obj<< /Length ${contentLen} >>stream\n${content}\nendstream\nendobj\n`,
    "5 0 obj<< /Type /Font /Subtype /Type0 /BaseFont /KozMinPro-Regular-Acro /Encoding /UniJIS-UCS2-H /DescendantFonts [6 0 R] >>endobj\n",
    "6 0 obj<< /Type /Font /Subtype /CIDFontType0 /BaseFont /KozMinPro-Regular-Acro /CIDSystemInfo << /Registry (Adobe) /Ordering (Japan1) /Supplement 0 >> /FontDescriptor 7 0 R /DW 1000 >>endobj\n",
    "7 0 obj<< /Type /FontDescriptor /FontName /KozMinPro-Regular-Acro /Flags 6 /FontBBox [-500 -300 1200 1200] /ItalicAngle 0 /Ascent 1000 /Descent -200 /CapHeight 800 /StemV 80 >>endobj\n",
  ];
  const body = buildDeterministicPdf(objects);
  await writePdfFixture("cjk-cmap.pdf", body);
}

/** Empty /Pages tree (/Count 0) for the empty-state fixture. */
async function generateZeroPagePdf(): Promise<void> {
  const objects = [
    "1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
    "2 0 obj<< /Type /Pages /Kids [] /Count 0 >>endobj\n",
  ];
  const body = buildDeterministicPdf(objects);
  await writePdfFixture("zero-page.pdf", body);
}

/**
 * Generate ONLY the fn-112 checked-in PDF fixtures.
 * Does not touch sample.pdf / docx / xlsx / pptx (I2-3).
 */
export async function generateViewerPdfFixtures(): Promise<void> {
  await generateViewerLinkFixture();
  await generateCorruptPdf();
  await generateJsActionPdf();
  await generateStandardFontPdf();
  await generateCjkCmapPdf();
  await generateZeroPagePdf();
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const fn112Only =
    process.argv.includes("--fn112-only") ||
    process.argv.includes("--fn-112-only");

  if (fn112Only) {
    console.log("Generating fn-112 PDF fixtures only (no sample.* churn)...\n");
    await generateViewerPdfFixtures();
    console.log(`\n✓ fn-112 fixtures: ${FN112_FIXTURE_NAMES.join(", ")}`);
    return;
  }

  console.log("Generating test fixtures...\n");

  await generatePdf();
  await generateDocx();
  await generateXlsx();
  await generatePptx();
  await generateViewerPdfFixtures();

  console.log("\n✓ All fixtures generated successfully");
}

main().catch((err) => {
  console.error("Failed to generate fixtures:", err);
  process.exit(1);
});

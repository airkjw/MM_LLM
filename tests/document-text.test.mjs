import assert from "node:assert/strict";
import test from "node:test";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import { extractDocx, extractPdf, extractXlsx } from "../src/main/document-text.ts";

test("an Excel attachment keeps sheet names and cell values", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("병원 지표");
  sheet.addRow(["월", "외래 수", "매출"]);
  sheet.addRow(["9월", 214, 12700000]);
  const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
  const text = await extractXlsx(bytes);
  assert.match(text, /\[시트: 병원 지표\]/);
  assert.match(text, /월\t외래 수\t매출/);
  assert.match(text, /9월\t214\t12700000/);
});

test("a Word attachment yields the paragraph text", async () => {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>병원 운영 분석</w:t></w:r></w:p></w:body></w:document>`);
  const text = await extractDocx(await zip.generateAsync({ type: "nodebuffer" }));
  assert.match(text, /병원 운영 분석/);
});

function smallPdf(text) {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 300] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"
  ];
  const stream = `BT /F1 18 Tf 30 200 Td (${text}) Tj ET`;
  objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(body));
    body += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body);
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${String(offset).padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body);
}

test("a PDF attachment yields selectable text", async () => {
  assert.match(await extractPdf(smallPdf("Medical MBA")), /Medical MBA/);
});

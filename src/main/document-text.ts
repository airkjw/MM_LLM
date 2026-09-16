import mammoth from "mammoth";
import ExcelJS from "exceljs";

export async function extractPdf(bytes: Buffer): Promise<string> {
  const parser = (await import("pdf-parse/lib/pdf-parse.js")).default as
    (input: Buffer) => Promise<{ text: string }>;
  return (await parser(bytes)).text;
}

export async function extractDocx(bytes: Buffer): Promise<string> {
  return (await mammoth.extractRawText({ buffer: bytes })).value;
}

export async function extractXlsx(bytes: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(new Uint8Array(bytes) as never);
  const lines: string[] = [];
  workbook.eachSheet((sheet) => {
    lines.push(`[시트: ${sheet.name}]`);
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells = row.values as Array<unknown>;
      lines.push(cells.slice(1).map((cell) => {
        if (cell === null || cell === undefined) return "";
        if (typeof cell === "object") return JSON.stringify(cell);
        return String(cell);
      }).join("\t"));
    });
  });
  return lines.join("\n");
}

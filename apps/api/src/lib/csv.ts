import type { Response } from "express";

const UTF8_BOM = "\uFEFF";

function escapeCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);

  // Neutralise spreadsheet formula injection (CSV injection / OWASP A03).
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;

  if (guarded.includes(",") || guarded.includes("\"") || guarded.includes("\n") || guarded.includes("\r")) {
    return `"${guarded.replaceAll("\"", "\"\"")}"`;
  }

  return guarded;
}

export function buildCsv(headers: string[], rows: Array<Record<string, unknown>>) {
  const lines = [headers.map(escapeCell).join(",")];

  for (const row of rows) {
    lines.push(headers.map((header) => escapeCell(row[header])).join(","));
  }

  return `${lines.join("\r\n")}\r\n`;
}

export function sendCsv(res: Response, fileName: string, csv: string) {
  const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safeName}"`);
  return res.status(200).send(`${UTF8_BOM}${csv}`);
}

/**
 * RFC 4180 style parser: handles quoted cells, escaped quotes and CRLF/LF line endings.
 * Returns an array of objects keyed by the trimmed header row.
 */
export function parseCsv(input: string): Array<Record<string, string>> {
  const text = input.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let cell = "";
  let row: string[] = [];
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (inQuotes) {
      if (char === "\"") {
        if (text[index + 1] === "\"") {
          cell += "\"";
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === "\"") {
      inQuotes = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (inQuotes) {
    throw new Error("Malformed CSV: unterminated quoted field");
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  const nonEmpty = rows.filter((entry) => entry.some((value) => value.trim().length > 0));
  if (nonEmpty.length === 0) {
    return [];
  }

  const headers = nonEmpty[0].map((header) => header.trim());

  return nonEmpty.slice(1).map((entry) => {
    const record: Record<string, string> = {};
    headers.forEach((header, columnIndex) => {
      record[header] = (entry[columnIndex] ?? "").trim();
    });
    return record;
  });
}

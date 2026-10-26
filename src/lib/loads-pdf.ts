export type SelectedLoadPdfRecord = {
  loadNumber: string;
  broker: string;
  route: string;
  status: string;
  revenue: number;
  driverPay: number;
  cut: number;
  paidAmount: number;
  paidDate: string;
};

const PAGE_WIDTH = 792;
const PAGE_HEIGHT = 612;
const MARGIN = 36;
const ROWS_PER_PAGE = 23;
const COLUMN_WIDTHS = [56, 86, 164, 62, 66, 66, 54, 72, 88];
const COLUMN_LABELS = [
  "Load",
  "Broker",
  "Route",
  "Status",
  "Revenue",
  "Driver pay",
  "CUT",
  "Paid",
  "Paid date",
];

function pdfText(value: string, maxChars: number) {
  const text = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, "-")
    .replace(/[()\\]/g, "\\$&");
  return text.length > maxChars ? `${text.slice(0, Math.max(0, maxChars - 3))}...` : text;
}

function amount(value: number) {
  return `$${Number(value || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function textCommand(text: string, x: number, y: number, size = 8, color = "0.12 0.17 0.22") {
  return `BT /F1 ${size} Tf ${color} rg 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm (${text}) Tj ET\n`;
}

function rectCommand(x: number, y: number, width: number, height: number, color: string) {
  return `${color} rg ${x} ${y} ${width} ${height} re f\n`;
}

function makePageContent(
  records: SelectedLoadPdfRecord[],
  pageNumber: number,
  pageCount: number,
  totals: { revenue: number; paid: number; count: number },
  generatedOn: string,
) {
  const stream: string[] = [];
  stream.push(
    textCommand("Vantera - Selected loads", MARGIN, PAGE_HEIGHT - 38, 17, "0.05 0.20 0.30"),
  );
  stream.push(
    textCommand(
      `Generated ${pdfText(generatedOn, 24)}  |  ${records.length} loads on this page`,
      MARGIN,
      PAGE_HEIGHT - 57,
      8,
      "0.35 0.42 0.48",
    ),
  );
  if (pageNumber === 1) {
    stream.push(
      textCommand(
        `${totals.count} selected loads  |  Revenue: ${amount(totals.revenue)}  |  Marked paid: ${amount(totals.paid)}`,
        MARGIN,
        PAGE_HEIGHT - 77,
        10,
        "0.05 0.20 0.30",
      ),
    );
  }

  const tableTop = 104;
  const headerHeight = 22;
  const rowHeight = 19;
  const tableX = MARGIN;
  const tableWidth = COLUMN_WIDTHS.reduce((sum, width) => sum + width, 0);
  let tableY = PAGE_HEIGHT - tableTop - headerHeight;
  stream.push(rectCommand(tableX, tableY, tableWidth, headerHeight, "0.05 0.20 0.30"));
  let x = tableX;
  COLUMN_LABELS.forEach((label, index) => {
    stream.push(textCommand(pdfText(label, 16), x + 4, tableY + 7, 7, "1 1 1"));
    x += COLUMN_WIDTHS[index] ?? 0;
  });

  records.forEach((record, index) => {
    tableY -= rowHeight;
    if (index % 2 === 0)
      stream.push(rectCommand(tableX, tableY, tableWidth, rowHeight, "0.94 0.96 0.97"));
    const values = [
      record.loadNumber,
      record.broker,
      record.route,
      record.status,
      amount(record.revenue),
      amount(record.driverPay),
      amount(record.cut),
      amount(record.paidAmount),
      record.paidDate || "-",
    ];
    x = tableX;
    values.forEach((value, columnIndex) => {
      const width = COLUMN_WIDTHS[columnIndex] ?? 50;
      const maxChars = Math.max(5, Math.floor((width - 8) / 4.2));
      stream.push(textCommand(pdfText(value, maxChars), x + 4, tableY + 6, 7));
      x += width;
    });
  });

  stream.push(
    textCommand(
      `Page ${pageNumber} of ${pageCount}`,
      PAGE_WIDTH - MARGIN - 58,
      24,
      8,
      "0.35 0.42 0.48",
    ),
  );
  return stream.join("");
}

export function createSelectedLoadsPdf(records: SelectedLoadPdfRecord[], generatedOn: string) {
  const pages: SelectedLoadPdfRecord[][] = [];
  for (let index = 0; index < records.length; index += ROWS_PER_PAGE) {
    pages.push(records.slice(index, index + ROWS_PER_PAGE));
  }

  const revenue = records.reduce((sum, record) => sum + record.revenue, 0);
  const paid = records.reduce((sum, record) => sum + record.paidAmount, 0);
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
  ];
  const pageIds: number[] = [];

  pages.forEach((page, index) => {
    const content = makePageContent(
      page,
      index + 1,
      pages.length,
      { revenue, paid, count: records.length },
      generatedOn,
    );
    const contentId = objects.length + 1;
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}endstream`);
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  return new TextEncoder().encode(pdf);
}

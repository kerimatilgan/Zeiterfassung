import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { Parser } from 'htmlparser2';

interface EmployeeForPdf {
  firstName: string;
  lastName: string;
  employeeNumber: string;
  email: string | null;
  phone: string | null;
  rfidCard: string | null;
  weeklyHours: number;
  vacationDaysPerYear: number;
  workDays: string;
  startDate: Date | null;
  defaultClockOut: string | null;
  workCategory: { name: string; earliestClockIn: string } | null;
}

interface SettingsForPdf {
  companyName: string;
  companyAddress: string | null;
  companyPhone: string | null;
  companyEmail: string | null;
}

const DAY_NAMES_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

function formatWorkDays(csv: string): string {
  const nums = csv.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)).sort((a, b) => a - b);
  if (nums.length === 0) return '-';
  // Konsekutiv zusammenfassen
  const parts: string[] = [];
  let start = nums[0];
  let prev = nums[0];
  for (let i = 1; i <= nums.length; i++) {
    const n = nums[i];
    if (n !== prev + 1) {
      parts.push(start === prev ? DAY_NAMES_SHORT[start] : `${DAY_NAMES_SHORT[start]}-${DAY_NAMES_SHORT[prev]}`);
      start = n as number;
    }
    prev = n as number;
  }
  return parts.join(', ');
}

function formatDate(d: Date | null): string {
  if (!d) return '-';
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
}

function buildVariables(emp: EmployeeForPdf, settings: SettingsForPdf): Record<string, string> {
  return {
    firstName: emp.firstName,
    lastName: emp.lastName,
    fullName: `${emp.firstName} ${emp.lastName}`,
    employeeNumber: emp.employeeNumber,
    rfidCard: emp.rfidCard || '-',
    email: emp.email || '-',
    phone: emp.phone || '-',
    weeklyHours: String(emp.weeklyHours),
    vacationDaysPerYear: String(emp.vacationDaysPerYear),
    workDays: formatWorkDays(emp.workDays),
    workCategory: emp.workCategory?.name || '-',
    earliestClockIn: emp.workCategory?.earliestClockIn || '-',
    defaultClockOut: emp.defaultClockOut || '-',
    startDate: formatDate(emp.startDate),
    today: formatDate(new Date()),
    companyName: settings.companyName,
    companyAddress: settings.companyAddress || '',
    companyPhone: settings.companyPhone || '',
    companyEmail: settings.companyEmail || '',
  };
}

function replaceVariables(html: string, vars: Record<string, string>): string {
  return html.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    if (key in vars) {
      // HTML-escape die Werte, weil sie in HTML eingesetzt werden
      return String(vars[key])
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }
    return match;
  });
}

// Decode die gängigsten HTML-Entities, die Quill erzeugt
function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&auml;/g, 'ä').replace(/&ouml;/g, 'ö').replace(/&uuml;/g, 'ü')
    .replace(/&Auml;/g, 'Ä').replace(/&Ouml;/g, 'Ö').replace(/&Uuml;/g, 'Ü')
    .replace(/&szlig;/g, 'ß')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

// Inline-Text-Run mit Formatierung
interface TextRun {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
}

// Block = ein Absatz/Überschrift/Listenpunkt
type BlockType = 'p' | 'h1' | 'h2' | 'h3' | 'li-bullet' | 'li-number' | 'blockquote';
interface Block {
  type: BlockType;
  runs: TextRun[];
  listIndex?: number; // nur bei li-number
}

// HTML-Parser: baut eine flache Liste von Blocks
function parseHtmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];
  let currentBlock: Block | null = null;
  let currentType: BlockType = 'p';
  const formatStack: Array<{ bold?: boolean; italic?: boolean; underline?: boolean }> = [];
  const listStack: Array<{ ordered: boolean; counter: number }> = [];

  function currentFormat() {
    const fmt = { bold: false, italic: false, underline: false };
    for (const f of formatStack) {
      if (f.bold) fmt.bold = true;
      if (f.italic) fmt.italic = true;
      if (f.underline) fmt.underline = true;
    }
    return fmt;
  }

  function ensureBlock() {
    if (!currentBlock) {
      currentBlock = { type: currentType, runs: [] };
    }
  }

  function finishBlock() {
    if (currentBlock) {
      // Whitespace-only-Blöcke verwerfen (Formatting-Whitespace zwischen Tags)
      const hasContent = currentBlock.runs.some(r => r.text.trim().length > 0);
      if (hasContent) blocks.push(currentBlock);
      currentBlock = null;
    }
  }

  const parser = new Parser({
    onopentag(name) {
      switch (name) {
        case 'h1': case 'h2': case 'h3':
          finishBlock();
          currentType = name;
          break;
        case 'p': case 'div':
          finishBlock();
          currentType = listStack.length > 0
            ? (listStack[listStack.length - 1].ordered ? 'li-number' : 'li-bullet')
            : 'p';
          break;
        case 'ul':
          finishBlock();
          listStack.push({ ordered: false, counter: 0 });
          currentType = 'li-bullet';
          break;
        case 'ol':
          finishBlock();
          listStack.push({ ordered: true, counter: 0 });
          currentType = 'li-number';
          break;
        case 'li':
          finishBlock();
          if (listStack.length > 0) {
            const top = listStack[listStack.length - 1];
            if (top.ordered) {
              top.counter++;
              currentType = 'li-number';
              currentBlock = { type: 'li-number', runs: [], listIndex: top.counter };
            } else {
              currentType = 'li-bullet';
              currentBlock = { type: 'li-bullet', runs: [] };
            }
          }
          break;
        case 'blockquote':
          finishBlock();
          currentType = 'blockquote';
          break;
        case 'strong': case 'b':
          formatStack.push({ bold: true });
          break;
        case 'em': case 'i':
          formatStack.push({ italic: true });
          break;
        case 'u':
          formatStack.push({ underline: true });
          break;
        case 'br':
          ensureBlock();
          currentBlock!.runs.push({ text: '\n', ...currentFormat() });
          break;
      }
    },
    ontext(text) {
      const decoded = decodeEntities(text);
      if (!decoded) return;
      ensureBlock();
      currentBlock!.runs.push({ text: decoded, ...currentFormat() });
    },
    onclosetag(name) {
      switch (name) {
        case 'h1': case 'h2': case 'h3':
        case 'p': case 'div':
        case 'blockquote':
          finishBlock();
          currentType = listStack.length > 0
            ? (listStack[listStack.length - 1].ordered ? 'li-number' : 'li-bullet')
            : 'p';
          break;
        case 'li':
          finishBlock();
          break;
        case 'ul': case 'ol':
          finishBlock();
          listStack.pop();
          currentType = listStack.length > 0
            ? (listStack[listStack.length - 1].ordered ? 'li-number' : 'li-bullet')
            : 'p';
          break;
        case 'strong': case 'b':
        case 'em': case 'i':
        case 'u':
          formatStack.pop();
          break;
      }
    },
  }, { decodeEntities: true });

  parser.write(html);
  parser.end();
  finishBlock();

  return blocks;
}

function pdfFontName(bold: boolean, italic: boolean): string {
  if (bold && italic) return 'Helvetica-BoldOblique';
  if (bold) return 'Helvetica-Bold';
  if (italic) return 'Helvetica-Oblique';
  return 'Helvetica';
}

function findLogoPath(): string | null {
  const logoDir = path.join(process.cwd(), 'uploads', 'logos');
  if (!fs.existsSync(logoDir)) return null;
  // pdfkit unterstützt PNG und JPEG — andere (webp/svg) überspringen
  for (const ext of ['.png', '.jpg', '.jpeg']) {
    const candidate = path.join(logoDir, `terminal-logo${ext}`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

export interface SignatureInfo {
  signedAt: Date;
  signedByName: string;
  signedIp: string | null;
}

export async function renderEmployeeInfoPDF(
  employee: EmployeeForPdf,
  settings: SettingsForPdf,
  templateHtml: string,
  outputPath: string,
  signature?: SignatureInfo | null,
): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const vars = buildVariables(employee, settings);
      const rendered = replaceVariables(templateHtml, vars);
      const blocks = parseHtmlToBlocks(rendered);

      const doc = new PDFDocument({
        margins: { top: 40, bottom: 40, left: 50, right: 50 },
        size: 'A4',
        bufferPages: true,
      });
      const stream = fs.createWriteStream(outputPath);
      doc.pipe(stream);

      // Kompakter Header: Logo links, Firmenname + Adresse daneben
      const logoPath = findLogoPath();
      const headerTop = doc.y;
      const logoSize = 44;
      if (logoPath) {
        try { doc.image(logoPath, 50, headerTop, { fit: [logoSize, logoSize] }); } catch { /* Logo-Fehler ignorieren */ }
      }
      const textX = logoPath ? 50 + logoSize + 12 : 50;
      doc.font('Helvetica-Bold').fontSize(13).fillColor('#111827');
      doc.text(settings.companyName, textX, headerTop + 4, { lineBreak: false });
      if (settings.companyAddress) {
        doc.font('Helvetica').fontSize(9).fillColor('#6B7280')
          .text(settings.companyAddress, textX, headerTop + 22, { lineBreak: false });
      }
      doc.y = headerTop + logoSize + 6;

      // Trennlinie
      doc.moveTo(50, doc.y).lineTo(545, doc.y).strokeColor('#E5E7EB').lineWidth(1).stroke();
      doc.moveDown(0.4);
      doc.fillColor('#111827');

      // Blocks rendern
      for (const block of blocks) {
        renderBlock(doc, block);
      }

      // Optional: Signatur-Block am Ende
      if (signature) {
        renderSignatureBlock(doc, signature);
      }

      // Footer: Seitenzahlen — bottom-margin temporär auf 0, sonst legt pdfkit neue Seiten an
      const range = doc.bufferedPageRange();
      for (let i = 0; i < range.count; i++) {
        doc.switchToPage(range.start + i);
        const prevBottom = doc.page.margins.bottom;
        doc.page.margins.bottom = 0;
        doc.font('Helvetica').fontSize(8).fillColor('#9CA3AF')
          .text(`Seite ${i + 1} von ${range.count}`, 50, doc.page.height - 25, {
            align: 'center', width: 495, lineBreak: false,
          });
        doc.page.margins.bottom = prevBottom;
      }

      doc.end();
      stream.on('finish', () => resolve());
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
}

function renderSignatureBlock(doc: PDFKit.PDFDocument, sig: SignatureInfo) {
  const leftMargin = 50;
  const boxWidth = 495;
  const pad = 10;

  doc.moveDown(1.5);
  const yStart = doc.y;

  // Text vorbereiten
  const dt = new Date(sig.signedAt);
  const dateStr = `${String(dt.getDate()).padStart(2, '0')}.${String(dt.getMonth() + 1).padStart(2, '0')}.${dt.getFullYear()}`;
  const timeStr = `${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;

  // Höhe grob berechnen (3 Zeilen Text + Padding)
  const lineHeight = 13;
  const titleHeight = 14;
  const boxHeight = pad + titleHeight + 4 + lineHeight * 3 + pad;

  // Grüner Hintergrund + Rahmen
  doc.save();
  doc.roundedRect(leftMargin, yStart, boxWidth, boxHeight, 4).fillAndStroke('#ECFDF5', '#10B981');
  doc.restore();

  const textX = leftMargin + pad;
  let y = yStart + pad;

  // Titel
  doc.font('Helvetica-Bold').fontSize(10).fillColor('#065F46');
  doc.text('✓ Elektronisch bestätigt', textX, y, { lineBreak: false, width: boxWidth - 2 * pad });
  y += titleHeight + 2;

  doc.font('Helvetica').fontSize(9).fillColor('#065F46');
  doc.text(`Unterzeichner: ${sig.signedByName}`, textX, y, { lineBreak: false, width: boxWidth - 2 * pad });
  y += lineHeight;
  doc.text(`Zeitpunkt: ${dateStr} um ${timeStr} Uhr`, textX, y, { lineBreak: false, width: boxWidth - 2 * pad });
  y += lineHeight;
  if (sig.signedIp) {
    doc.text(`IP-Adresse: ${sig.signedIp}`, textX, y, { lineBreak: false, width: boxWidth - 2 * pad });
  }

  doc.y = yStart + boxHeight + 4;
  doc.fillColor('#111827');
}

function renderBlock(doc: PDFKit.PDFDocument, block: Block) {
  // Abstand vor dem Block (in Zeilenhöhen) — kompakt, damit das Schreiben auf 1 Seite passt
  const topMargin: Record<BlockType, number> = {
    h1: 0.5, h2: 0.7, h3: 0.5,
    p: 0.25, 'li-bullet': 0.05, 'li-number': 0.05, blockquote: 0.4,
  };
  const fontSize: Record<BlockType, number> = {
    h1: 16, h2: 12.5, h3: 11,
    p: 10, 'li-bullet': 10, 'li-number': 10, blockquote: 10,
  };

  doc.moveDown(topMargin[block.type]);

  const baseBold = block.type === 'h1' || block.type === 'h2' || block.type === 'h3';
  const leftMargin = 50;
  const maxWidth = 495;

  let x = leftMargin;
  let width = maxWidth;
  let runs = block.runs;

  if (block.type === 'li-bullet') {
    // Bullet als führender Run in den Text-Flow einbetten — kein separater text()-Call,
    // damit pdfkit die Wrap-Box nicht auf Bullet-Breite zusammenschrumpft.
    runs = [
      { text: '•   ', bold: false, italic: false, underline: false },
      ...block.runs,
    ];
  } else if (block.type === 'li-number') {
    runs = [
      { text: `${block.listIndex ?? '?'}.   `, bold: false, italic: false, underline: false },
      ...block.runs,
    ];
  } else if (block.type === 'blockquote') {
    x = leftMargin + 20;
    width = maxWidth - 20;
  }

  const yStart = doc.y;
  renderRuns(doc, runs, x, yStart, width, fontSize[block.type], baseBold);

  if (block.type === 'blockquote') {
    const yEnd = doc.y;
    doc.save();
    doc.moveTo(leftMargin + 5, yStart).lineTo(leftMargin + 5, yEnd)
      .strokeColor('#CBD5E1').lineWidth(3).stroke();
    doc.restore();
    doc.fillColor('#111827');
  }
}

// Rendert eine Folge von Inline-Runs als einen zusammenhängenden Textfluss.
// Wichtig: `width` und die Start-Koordinaten NUR im ersten doc.text()-Aufruf setzen;
// alle folgenden Runs hängen per `continued: true` an und erben die Wrap-Box.
function renderRuns(
  doc: PDFKit.PDFDocument,
  runs: TextRun[],
  x: number,
  y: number,
  width: number,
  size: number,
  baseBold: boolean,
) {
  if (runs.length === 0) return;

  // \n -> explizite Zeilenumbrüche als separate Chunks
  type Chunk = { text: string; bold: boolean; italic: boolean; underline: boolean; breakBefore: boolean };
  const chunks: Chunk[] = [];
  for (const r of runs) {
    const parts = r.text.split('\n');
    parts.forEach((p, i) => {
      chunks.push({
        text: p,
        bold: r.bold,
        italic: r.italic,
        underline: r.underline,
        breakBefore: i > 0,
      });
    });
  }

  // Leere Rand-Chunks trimmen
  while (chunks.length > 0 && chunks[0].text === '' && !chunks[0].breakBefore) chunks.shift();
  while (chunks.length > 0 && chunks[chunks.length - 1].text === '') chunks.pop();
  if (chunks.length === 0) return;

  let firstInFlow = true;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];

    if (chunk.breakBefore && !firstInFlow) {
      // Aktuellen Textfluss beenden; pdfkit positioniert doc.y auf die nächste Zeile
      doc.text('', { continued: false });
      firstInFlow = true;
    }

    if (chunk.text === '') continue;

    // Ist das der letzte nicht-leere Chunk ohne weitere Zeilenumbrüche danach?
    const isLast = chunks.slice(i + 1).every(c => c.text === '' && !c.breakBefore);

    const bold = baseBold || chunk.bold;
    doc.font(pdfFontName(bold, chunk.italic)).fontSize(size).fillColor('#111827');

    if (firstInFlow) {
      // Erster Call im Flow: x/y/width setzen — das definiert die Wrap-Box für den ganzen Block
      doc.text(chunk.text, x, doc.y, {
        continued: !isLast,
        width,
        underline: chunk.underline || undefined,
      });
      firstInFlow = false;
    } else {
      // Folge-Calls: NUR options, keine Koordinaten/width — sonst bricht pdfkit den Flow
      doc.text(chunk.text, {
        continued: !isLast,
        underline: chunk.underline || undefined,
      });
    }
  }
}

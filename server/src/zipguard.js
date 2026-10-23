// Office files (.docx, .pptx, .xlsx, .ods) are zip archives. A small upload can unpack to gigabytes
// (a "zip bomb") and take the server down while it's being read. Check the sizes the archive
// declares before anything unpacks it.
import fs from 'node:fs/promises';

const MAX_TOTAL = 300 * 1024 * 1024; // unpacked
const MAX_ENTRIES = 5000;
const MAX_RATIO = 200;              // unpacked : packed, per entry (normal office files are well under 50)

export class ZipError extends Error {}

/** Throws if the archive (a path or a Buffer) would unpack to something unreasonable. */
export async function assertSafeZip(fileOrBuffer) {
  const JSZip = (await import('jszip')).default;
  const buf = Buffer.isBuffer(fileOrBuffer) ? fileOrBuffer : await fs.readFile(fileOrBuffer);
  let zip;
  try { zip = await JSZip.loadAsync(buf, { checkCRC32: false }); }
  catch { throw new ZipError('That file looks damaged, so Heartwood couldn’t open it.'); }
  const entries = Object.values(zip.files);
  if (entries.length > MAX_ENTRIES) throw new ZipError('That file has too many parts to read safely.');
  let total = 0;
  for (const e of entries) {
    const d = e._data || {};
    const size = Number(d.uncompressedSize || 0), packed = Number(d.compressedSize || 0);
    total += size;
    if (total > MAX_TOTAL) throw new ZipError('That file unpacks to more than Heartwood will read safely.');
    if (packed > 0 && size / packed > MAX_RATIO && size > 10 * 1024 * 1024) throw new ZipError('That file is compressed in a way Heartwood won’t open.');
  }
}

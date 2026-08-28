// Inspeksi arsip RAR: daftar isi + ekstraksi file teks kecil.
// node-unrar-js (WASM) di-import dinamis agar tidak membebani jalur request lain.

const TEXT_EXTENSIONS = new Set([
  "txt", "md", "markdown", "json", "jsonc", "js", "mjs", "cjs", "ts", "tsx", "jsx",
  "py", "rb", "php", "java", "c", "h", "cpp", "hpp", "cs", "go", "rs", "swift",
  "kt", "csv", "tsv", "html", "htm", "css", "scss", "xml", "yml", "yaml", "toml",
  "ini", "cfg", "conf", "env", "log", "sql", "sh", "bat", "ps1", "svg", "gitignore",
]);

const MAX_EXTRACT_FILES = 200;
const MAX_TEXT_BYTES = 64 * 1024;
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

export interface ArchiveEntry {
  name: string;
  size: number;
  isText: boolean;
  content?: string;
}

function isProbablyText(name: string, data: Uint8Array): boolean {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (TEXT_EXTENSIONS.has(ext)) return true;
  // Heuristik: file biner biasanya mengandung byte 0x00 di bagian awal
  const scan = Math.min(data.length, 1024);
  for (let i = 0; i < scan; i++) {
    if (data[i] === 0) return false;
  }
  return true;
}

export async function inspectArchive(buf: ArrayBuffer): Promise<ArchiveEntry[]> {
  if (buf.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`Arsip terlalu besar (maks ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB).`);
  }
  const { createExtractorFromData } = await import("node-unrar-js");
  const extractor = await createExtractorFromData(new Uint8Array(buf));

  const listed = extractor.getFileList();
  const headers = [...listed.fileHeaders];

  const extracted = new Map<string, Uint8Array>();
  try {
    const result = extractor.extract({});
    for (const f of result.files) {
      if (f.extraction && extracted.size < MAX_EXTRACT_FILES) {
        extracted.set(f.fileHeader.name, f.extraction);
      }
    }
  } catch {
    // Ekstraksi gagal — tetap kembalikan daftar isi saja
  }

  const entries: ArchiveEntry[] = [];
  for (const h of headers) {
    if ((h.flags as any)?.directory) continue;
    const name = h.name;
    const size = (h as any).unpackedSize ?? (h as any).packSize ?? 0;
    const data = extracted.get(name);
    const isText = !!data && isProbablyText(name, data);
    entries.push({
      name,
      size,
      isText,
      content: isText ? new TextDecoder().decode(data.subarray(0, MAX_TEXT_BYTES)) : undefined,
    });
  }
  return entries;
}

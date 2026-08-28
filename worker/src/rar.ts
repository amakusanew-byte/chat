// Inspeksi arsip RAR: daftar isi + ekstraksi file teks kecil.
// node-unrar-js (WASM): file .wasm di-import sebagai WebAssembly.Module
// terkompilasi (default wrangler) lalu di-instance via hook instantiateWasm —
// Workers melarang kompilasi WASM dari bytes dan evaluasi string dinamis,
// jadi scripts/patch-unrar.js mem-patch emscripten/embind agar bebas keduanya.
import unrarFactory from "node-unrar-js/esm/js/unrar";
import { ExtractorData } from "node-unrar-js/esm/js/ExtractorData";
import unrarWasmModule from "node-unrar-js/esm/js/unrar.wasm";

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

// Singleton modul unrar: factory hanya boleh dijalankan sekali (WASM memory global).
let unrarModulePromise: Promise<any> | null = null;
function getUnrar(): Promise<any> {
  if (!unrarModulePromise) {
    unrarModulePromise = unrarFactory({
      // Workers melarang kompilasi WASM dari bytes saat runtime; file .wasm
      // sudah di-import sebagai WebAssembly.Module terkompilasi oleh wrangler,
      // tinggal di-instance dengan imports milik emscripten.
      instantiateWasm: (info: any, receiveInstance: (instance: any) => void) => {
        const instance = new WebAssembly.Instance(unrarWasmModule, info);
        receiveInstance(instance);
        return instance.exports;
      },
    });
  }
  return unrarModulePromise;
}

export async function inspectArchive(buf: ArrayBuffer): Promise<ArchiveEntry[]> {
  if (buf.byteLength > MAX_ARCHIVE_BYTES) {
    throw new Error(`Arsip terlalu besar (maks ${MAX_ARCHIVE_BYTES / 1024 / 1024} MB).`);
  }
  const unrar = await getUnrar();
  const extractor = new (ExtractorData as any)(unrar, buf, "");
  unrar.extractor = extractor;

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

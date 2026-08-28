// Deklarasi modul untuk import .wasm (wrangler: module terkompilasi) dan
// deep-import factory emscripten dari node-unrar-js.
declare module "*.wasm" {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}

declare module "node-unrar-js/esm/js/unrar" {
  const unrarFactory: (options: Record<string, unknown>) => Promise<Record<string, any>>;
  export default unrarFactory;
}

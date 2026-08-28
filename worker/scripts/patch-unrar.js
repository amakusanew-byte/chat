// One-off: patch emscripten unrar.js (dist + esm) agar tidak pakai evaluasi
// string dinamis (dilarang di Cloudflare Workers):
//   1. createNamedFunction  -> pakai new Function (closure langsung)
//   2. craftInvokerFunction -> embind membuat invoker via new_(Function, body)
//      diganti invoker generik berbasis closure (setara -sNO_DYNAMIC_EXECUTION)
const fs = require("fs");
const path = require("path");

const targets = [
  path.resolve(__dirname, "../../node_modules/node-unrar-js/dist/js/unrar.js"),
  path.resolve(__dirname, "../../node_modules/node-unrar-js/esm/js/unrar.js"),
];

const REPL_CREATE_NAMED =
  'function createNamedFunction(name,body){name=makeLegalFunctionName(name);var f=function(){"use strict";return body.apply(this,arguments)};try{Object.defineProperty(f,"name",{value:name})}catch(e){}return f}';

// Invoker generik tanpa codegen; perilaku identik dengan versi emscripten
// (-sNO_DYNAMIC_EXECUTION): cek jumlah argumen, toWireType, invoker(fn,...),
// lalu destructors (stack mode atau dtor langsung), lalu fromWireType.
const REPL_CRAFT_INVOKER =
  'function craftInvokerFunction(humanName,argTypes,classType,cppInvokerFunc,cppTargetFunc){' +
  'var argCount=argTypes.length;' +
  'if(argCount<2){throwBindingError("argTypes array size mismatch! Must at least get return value and \'this\' types!")}' +
  'var isClassMethodFunc=argTypes[1]!==null&&classType!==null;' +
  'var needsDestructorStack=false;' +
  'for(var i=1;i<argTypes.length;++i){if(argTypes[i]!==null&&argTypes[i].destructorFunction===undefined){needsDestructorStack=true;break}}' +
  'var returns=argTypes[0].name!=="void";' +
  'var expectedArgs=argCount-2;' +
  'var retType=argTypes[0];' +
  'var classParam=argTypes[1];' +
  'var restTypes=[];' +
  'for(var i=2;i<argCount;++i){restTypes.push(argTypes[i])}' +
  'var invokerFunction=function(){' +
  'if(arguments.length!==expectedArgs){throwBindingError("function "+humanName+" called with "+arguments.length+" arguments, expected "+expectedArgs+" args!")}' +
  'var destructors=needsDestructorStack?[]:null;' +
  'var wired=[];' +
  'if(isClassMethodFunc){wired.push(classParam.toWireType(destructors,this))}' +
  'for(var i=0;i<expectedArgs;++i){wired.push(restTypes[i].toWireType(destructors,arguments[i]))}' +
  'var rv=cppInvokerFunc.apply(null,[cppTargetFunc].concat(wired));' +
  'if(needsDestructorStack){runDestructors(destructors)}' +
  'else{var startIdx=0;' +
  'if(isClassMethodFunc){if(argTypes[1].destructorFunction!==null){argTypes[1].destructorFunction(wired[0])}startIdx=1}' +
  'for(var i=0;i<expectedArgs;++i){var dtor=restTypes[i].destructorFunction;if(dtor!==null&&dtor!==undefined){dtor(wired[startIdx+i])}}}' +
  'if(returns){return retType.fromWireType(rv)}};' +
  'try{Object.defineProperty(invokerFunction,"name",{value:makeLegalFunctionName(humanName)})}catch(e){}' +
  'return invokerFunction}';

function replaceBetween(s, startMarker, endMarker, repl, mustContain, label) {
  const start = s.indexOf(startMarker);
  const end = s.indexOf(endMarker, start);
  if (start < 0 || end < 0) {
    console.error(`${label}: MARKER TIDAK KETEMU (start=${start}, end=${end})`);
    process.exit(1);
  }
  const oldFn = s.slice(start, end);
  if (!oldFn.includes(mustContain)) {
    console.log(`${label}: SUDAH TERPATCH / dilewati`);
    return s;
  }
  return s.slice(0, start) + repl + s.slice(end);
}

for (const target of targets) {
  let s = fs.readFileSync(target, "utf8");
  const tag = path.basename(path.dirname(target));

  s = replaceBetween(
    s,
    'function createNamedFunction(name,body){',
    'function extendError',
    REPL_CREATE_NAMED,
    'new Function',
    `createNamedFunction[${tag}]`
  );
  s = replaceBetween(
    s,
    'function craftInvokerFunction(',
    'function __embind_register_class_function',
    REPL_CRAFT_INVOKER,
    'new_(Function',
    `craftInvokerFunction[${tag}]`
  );
  fs.writeFileSync(target, s);
  console.log(
    `PATCHED ${tag} — sisa new Function:`,
    (s.match(/new Function/g) || []).length,
    "| sisa new_(Function:",
    (s.match(/new_\(Function/g) || []).length
  );
}

const re = /(?:readFile|writeFile|createReadStream|createWriteStream|path\.join|path\.resolve|fs\.(?:readFile|writeFile|createReadStream|createWriteStream))\s*\([^)]*(?:req\.|query\.|params\.|body\.|argv|user|input|path)/i;

console.log(re.source);
console.log("");
console.log("readFileSync(req.query.path):", re.test("readFileSync(req.query.path)"));
console.log("fs.readFileSync(req.query.path):", re.test("fs.readFileSync(req.query.path)"));
console.log("createReadStream(req.params.file):", re.test("createReadStream(req.params.file)"));

// O problema: readFileSync nao esta no grupo! So readFile, writeFile, etc.
// E fs. so casa com fs.readFile|writeFile|createReadStream|createWriteStream
// nao com fs.readFileSync

const re2 = /(?:readFileSync|writeFileSync|readFile|writeFile|createReadStream|createWriteStream|path\.join|path\.resolve|fs\.)/i;
console.log("\nre2:");
console.log("readFileSync(req.query.path):", re2.test("readFileSync(req.query.path)"));
console.log("fs.readFileSync(req.query.path):", re2.test("fs.readFileSync(req.query.path)"));

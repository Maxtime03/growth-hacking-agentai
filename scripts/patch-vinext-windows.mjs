import fs from "node:fs";
import path from "node:path";

const file = path.resolve("node_modules/vinext/dist/server/static-file-cache.js");
if (!fs.existsSync(file)) process.exit(0);
const source = fs.readFileSync(file, "utf8");
const before = "relativePath: path.relative(base, batch[j]),";
const after = "relativePath: path.relative(base, batch[j]).split(path.sep).join(\"/\"),";
if (source.includes(before)) {
  fs.writeFileSync(file, source.replace(before, after));
  console.log("Applied reproducible Vinext Windows static asset patch.");
} else if (!source.includes(after)) {
  throw new Error("Unsupported Vinext static-file-cache layout; inspect before upgrading.");
}

const esbuild = require("esbuild");
const path = require("node:path");

const root = path.join(__dirname, "..");

esbuild.buildSync({
  entryPoints: [path.join(root, "src", "renderer", "vendor-src.js")],
  bundle: true,
  minify: true,
  format: "iife",
  target: ["chrome120"],
  outfile: path.join(root, "src", "renderer", "vendor", "bundle.js"),
  logLevel: "info",
});

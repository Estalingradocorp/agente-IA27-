const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { IACore } = require("../src/main/ia27");

const projectDataDir = path.join(__dirname, "..", "ia27-data");
const dataDir =
  process.env.IA27_DATA_DIR ||
  (fs.existsSync(path.join(projectDataDir, "models")) ? projectDataDir : path.join(os.tmpdir(), "ia27-smoke-data"));
if (!fs.existsSync(path.join(dataDir, "models"))) {
  console.error("SMOKE FAILED: No hay carpeta de modelos en " + path.join(dataDir, "models"));
  console.error("Coloca un .gguf en ia27-data/models/ o define IA27_DATA_DIR.");
  process.exit(1);
}

async function main() {
  const prompt = process.argv.slice(2).join(" ") || "Saluda brevemente y di quién eres.";
  const core = new IACore({
    dataDir,
    openPath: async () => "smoke: no-op",
    consent: async () => true,
  });
  core.on("status", (s) => console.log("[status]", JSON.stringify(s)));
  core.on("gen:token", ({ text }) => process.stdout.write(text));
  await core.init();
  console.log("\n[modelo listo]");
  const conv = await core.newConversation();
  const reply = await core.send({ conversationId: conv.id, message: prompt });
  console.log("\n---REPLY META---");
  console.log(JSON.stringify({ contentLength: reply.content.length, toolCalls: reply.toolCalls }));
  await core.dispose();
  console.log("SMOKE OK");
}

main().catch((err) => {
  console.error("\nSMOKE FAILED:", err);
  process.exit(1);
});

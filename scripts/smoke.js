const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");
const { IACore } = require("../src/main/ia27");

const dataDir = path.join(os.tmpdir(), "ia27-smoke-data");
fs.mkdirSync(dataDir, { recursive: true });

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

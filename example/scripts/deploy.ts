import { execSync } from "node:child_process";
import { createWriteStream, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import archiver from "archiver";

const PROJECT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DIST_DIR = resolve(PROJECT_DIR, "dist");
const ZIP_PATH = resolve(PROJECT_DIR, "bundle.zip");

function parseArgs(argv: string[]) {
  const args = { setActive: true, notes: "", server: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--notes" || a === "-m") {
      args.notes = argv[++i] ?? "";
    } else if (a === "--no-set-active") {
      args.setActive = false;
    } else if (a === "--server" || a === "-s") {
      args.server = argv[++i] ?? "";
    }
  }
  return args;
}

function createZip(sourceDir: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = createWriteStream(outputPath);
    const archive = archiver("zip", { zlib: { level: 9 } });

    stream.on("close", () => resolve());
    archive.on("error", (err) => reject(err));

    archive.pipe(stream);
    archive.directory(sourceDir, false);
    archive.finalize();
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const server = (args.server || process.env.SERVER || "http://localhost:3000").replace(/\/$/, "");
  const notes = args.notes || process.env.NOTES || "";

  // read runtimeVersion from app.json
  const appJson = JSON.parse(readFileSync(resolve(PROJECT_DIR, "app.json"), "utf-8"));
  const runtimeVersion = appJson?.expo?.runtimeVersion;
  if (!runtimeVersion || typeof runtimeVersion !== "string") {
    console.error("app.json missing expo.runtimeVersion");
    process.exit(1);
  }

  console.log(`runtimeVersion=${runtimeVersion}, server=${server}`);

  // 1. expo export
  console.log("> Exporting bundle...");
  execSync("npx expo export", { stdio: "inherit", cwd: PROJECT_DIR });

  // 2. generate expoConfig.json
  console.log("> Generating expoConfig.json...");
  const { getConfig } = await import("@expo/config");
  const { exp } = getConfig(PROJECT_DIR, { skipSDKVersionRequirement: true, isPublicConfig: true });
  writeFileSync(resolve(DIST_DIR, "expoConfig.json"), JSON.stringify(exp));

  // 3. zip
  console.log("> Creating zip...");
  rmSync(ZIP_PATH, { force: true });
  await createZip(DIST_DIR, ZIP_PATH);

  // 4. upload
  console.log(`> Publishing to ${server} ...`);
  const form = new FormData();
  form.append("runtimeVersion", runtimeVersion);
  form.append("bundle", new File([readFileSync(ZIP_PATH)], "bundle.zip", { type: "application/zip" }));
  if (notes) form.append("notes", notes);
  if (!args.setActive) form.append("setActive", "false");

  const res = await fetch(`${server}/api/deploy`, { method: "POST", body: form });
  const body = await res.json();

  if (res.status === 201) {
    console.log("> Published successfully!");
    console.log(JSON.stringify(body, null, 2));
  } else {
    console.log(`> Publish failed (HTTP ${res.status})`);
    console.log(JSON.stringify(body, null, 2));
    process.exit(1);
  }

  rmSync(ZIP_PATH, { force: true });
}

main().catch((err) => {
  console.error("> Error:", err.message);
  process.exit(1);
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const errors = [];

function readJson(file) {
  try {
    return JSON.parse(readFileSync(resolve(root, file), "utf8"));
  } catch (error) {
    errors.push(`${file}: ${error.message}`);
    return null;
  }
}

function check(condition, message) {
  if (!condition) errors.push(message);
}

const opencode = readJson("opencode.json");
const railway = readJson("railway.json");

check(
  opencode?.mcp?.servers?.railway?.type === "remote",
  'opencode.json: expected mcp.servers.railway.type to be "remote"',
);
check(
  opencode?.mcp?.servers?.railway?.url === "https://mcp.railway.com",
  "opencode.json: expected mcp.servers.railway.url to be https://mcp.railway.com",
);
check(
  opencode?.mcp?.railway === undefined,
  "opencode.json: V1 shape mcp.railway is not supported; use mcp.servers.railway",
);

check(
  railway?.build?.builder === "DOCKERFILE",
  "railway.json: expected build.builder to be DOCKERFILE",
);
check(
  railway?.build?.dockerfilePath === "Dockerfile",
  "railway.json: expected build.dockerfilePath to be Dockerfile",
);
check(
  railway?.deploy?.healthcheckPath === "/health",
  "railway.json: expected deploy.healthcheckPath to be /health",
);
check(
  railway?.deploy?.sleepApplication === false,
  "railway.json: expected deploy.sleepApplication to be false",
);

if (errors.length > 0) {
  process.stderr.write(
    `deploy config check failed:\n${errors.map((error) => `- ${error}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("deploy config check passed\n");
}

#!/usr/bin/env node
require("ts-node/register/transpile-only");
const fs = require("fs");
const path = require("path");
const { swaggerSpec } = require("../src/swagger");

const projectRoot = path.resolve(__dirname, "..");
const outputDir = path.join(projectRoot, "docs");
const outputPath = path.join(outputDir, "openapi.json");

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

fs.writeFileSync(outputPath, JSON.stringify(swaggerSpec, null, 2) + "\n", "utf8");
console.log(`OpenAPI specification exported to ${outputPath}`);

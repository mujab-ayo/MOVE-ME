#!/usr/bin/env node
require("ts-node/register/transpile-only");
const fs = require("fs");
const path = require("path");
const request = require("supertest");
const app = require("../src/app").default;

async function run() {
  const projectRoot = path.resolve(__dirname, "..");
  const appPath = path.join(projectRoot, "src", "app.ts");

  if (!fs.existsSync(appPath)) {
    console.error(`Error: app.ts not found at ${appPath}`);
    process.exit(1);
  }

  const appContent = fs.readFileSync(appPath, "utf8");

  // 1. Derive real routes from code
  // In Express 5, router layers lose their static regex source and compile routes using path-to-regexp v8 closures.
  // We statically inspect app.use() mount prefixes in app.ts and router.(get|post|patch) definitions in route files.
  const routerImports = {};
  const importRegex = /import\s+(\w+)\s+from\s+["'](\.\/routes\/[\w.-]+)["']/g;
  let match;
  while ((match = importRegex.exec(appContent)) !== null) {
    routerImports[match[1]] = match[2];
  }

  const useRegex = /app\.use\s*\(\s*["']([^"']+)["']\s*,\s*(\w+)\s*\)/g;
  const mounts = [];
  while ((match = useRegex.exec(appContent)) !== null) {
    const prefix = match[1];
    const routerVar = match[2];
    if (routerImports[routerVar]) {
      mounts.push({
        prefix,
        routerVar,
        relativeFile: routerImports[routerVar] + ".ts",
      });
    }
  }

  const derivedRoutes = [];

  // Direct routes on app in app.ts (e.g. app.get("/health", ...))
  const appRouteRegex = /app\.(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']([\s\S]*?)(?=\n\s*(?:app\.|\/\*\*|export|const|\/\/|$))/g;
  while ((match = appRouteRegex.exec(appContent)) !== null) {
    const method = match[1].toLowerCase();
    const routePath = match[2];
    const middlewareStr = match[3];
    // Ignore internal doc and redirect routes
    if (routePath !== "/" && routePath !== "/docs" && routePath !== "/docs.json") {
      const openApiPath = routePath.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
      derivedRoutes.push({
        method,
        path: routePath,
        openApiPath,
        isProtected: middlewareStr.includes("requireAuth"),
        source: "src/app.ts",
      });
    }
  }

  // Routes defined in mounted router files
  for (const m of mounts) {
    const fullPath = path.join(projectRoot, "src", m.relativeFile);
    if (!fs.existsSync(fullPath)) continue;

    const fileContent = fs.readFileSync(fullPath, "utf8");
    const routeRegex = /router\.(get|post|patch|put|delete)\s*\(\s*["']([^"']+)["']([\s\S]*?)(?=\n\s*(?:router\.|\/\*\*|export|const|\/\/|$))/g;
    let rMatch;
    while ((rMatch = routeRegex.exec(fileContent)) !== null) {
      const method = rMatch[1].toLowerCase();
      const subPath = rMatch[2];
      const middlewareStr = rMatch[3];

      let fullPathStr = (m.prefix + (subPath === "/" ? "" : subPath)).replace(/\/+/g, "/");
      const openApiPath = fullPathStr.replace(/:([a-zA-Z0-9_]+)/g, "{$1}");
      const isProtected = middlewareStr.includes("requireAuth");

      derivedRoutes.push({
        method,
        path: fullPathStr,
        openApiPath,
        isProtected,
        source: m.relativeFile,
      });
    }
  }

  // 2. Fetch /docs.json from app
  const res = await request(app).get("/docs.json");
  if (res.status !== 200 || !res.body || !res.body.paths) {
    console.error("Error: Failed to fetch /docs.json or empty spec returned.");
    process.exit(1);
  }

  const spec = res.body;
  const specPaths = spec.paths;

  const errors = [];

  // Check 1: Missing routes in documentation
  for (const route of derivedRoutes) {
    const docPathObj = specPaths[route.openApiPath];
    if (!docPathObj) {
      errors.push(`Missing route in OpenAPI spec: ${route.method.toUpperCase()} ${route.openApiPath} (${route.source})`);
      continue;
    }
    const docOp = docPathObj[route.method];
    if (!docOp) {
      errors.push(`Missing operation in OpenAPI spec: ${route.method.toUpperCase()} ${route.openApiPath} (${route.source})`);
    }
  }

  // Check 2: Protected routes without security requirement
  for (const route of derivedRoutes) {
    if (!route.isProtected) continue;
    const docOp = specPaths[route.openApiPath]?.[route.method];
    if (!docOp) continue;

    const hasBearer = Array.isArray(docOp.security) && docOp.security.some((sec) => sec && sec.bearerAuth !== undefined);
    if (!hasBearer) {
      errors.push(`Protected route without security requirement (bearerAuth): ${route.method.toUpperCase()} ${route.openApiPath} (${route.source})`);
    }
  }

  // Check 3 & 4: Extra documented operations, missing summary or tag
  const validMethods = ["get", "post", "patch", "put", "delete"];
  for (const [p, methodsObj] of Object.entries(specPaths)) {
    for (const [m, op] of Object.entries(methodsObj)) {
      if (!validMethods.includes(m.toLowerCase())) continue;
      const method = m.toLowerCase();

      // Check if documented operation exists in code
      const matchingCodeRoute = derivedRoutes.find(
        (r) => r.openApiPath === p && r.method === method
      );
      if (!matchingCodeRoute) {
        errors.push(`Documented operation does not exist in code: ${method.toUpperCase()} ${p}`);
      }

      // Check if operation has summary
      if (!op.summary || typeof op.summary !== "string" || op.summary.trim().length === 0) {
        errors.push(`Documented operation without summary: ${method.toUpperCase()} ${p}`);
      }

      // Check if operation has tags
      if (!Array.isArray(op.tags) || op.tags.length === 0 || !op.tags[0]) {
        errors.push(`Documented operation without tag: ${method.toUpperCase()} ${p}`);
      }
    }
  }

  // 3. Report results
  if (errors.length > 0) {
    console.error(`\nFAILED: Found ${errors.length} OpenAPI specification issue(s):\n`);
    for (const err of errors) {
      console.error(`  - ${err}`);
    }
    console.error("");
    process.exit(1);
  }

  console.log(`\nSUCCESS: All ${derivedRoutes.length} derived code routes verified against OpenAPI documentation (/docs.json).`);
  console.log(`- All routes are documented.`);
  console.log(`- All operations have summaries and tags.`);
  console.log(`- All protected routes have bearerAuth security requirements.`);
  console.log(`- No orphaned operations exist.\n`);
  process.exit(0);
}

run().catch((err) => {
  console.error("Unhandled error running check-openapi:", err);
  process.exit(1);
});

"use strict";

const fs = require("fs");
const path = require("path");

const APP_ROOT = path.resolve(__dirname, "../../..");
const API_ROOT = path.join(APP_ROOT, "api");

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8");
};

const isDir = (target) => {
  try {
    return fs.statSync(target).isDirectory();
  } catch {
    return false;
  }
};

const isFile = (target) => {
  try {
    return fs.statSync(target).isFile();
  } catch {
    return false;
  }
};

const parseQuery = (urlValue) => {
  try {
    const url = new URL(String(urlValue || ""), "http://localhost");
    const out = {};
    for (const [key, value] of url.searchParams.entries()) {
      if (Object.prototype.hasOwnProperty.call(out, key)) {
        if (Array.isArray(out[key])) out[key].push(value);
        else out[key] = [out[key], value];
      } else {
        out[key] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
};

const resolveApiRoute = (urlValue) => {
  const url = new URL(String(urlValue || "/"), "http://localhost");
  const pathname = url.pathname.replace(/\/+$/, "") || "/";
  const segments = pathname.split("/").filter(Boolean);
  if (!segments.length || segments[0] !== "api") {
    return { modulePath: null, params: {} };
  }

  const routeSegments = segments.slice(1);
  const search = (dir, index, params) => {
    if (index >= routeSegments.length) {
      const indexFile = path.join(dir, "index.js");
      if (isFile(indexFile)) return { modulePath: indexFile, params };
      return null;
    }

    const segment = routeSegments[index];
    const isLast = index === routeSegments.length - 1;

    if (isLast) {
      const exactFile = path.join(dir, `${segment}.js`);
      if (isFile(exactFile)) return { modulePath: exactFile, params };
    }

    const exactDir = path.join(dir, segment);
    if (isDir(exactDir)) {
      const exactResult = search(exactDir, index + 1, params);
      if (exactResult) return exactResult;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    if (isLast) {
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const match = entry.name.match(/^\[(.+)\]\.js$/);
        if (!match) continue;
        return {
          modulePath: path.join(dir, entry.name),
          params: {
            ...params,
            [match[1]]: segment,
          },
        };
      }
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const match = entry.name.match(/^\[(.+)\]$/);
      if (!match) continue;
      const dynamicResult = search(path.join(dir, entry.name), index + 1, {
        ...params,
        [match[1]]: segment,
      });
      if (dynamicResult) return dynamicResult;
    }

    return null;
  };

  return search(API_ROOT, 0, {}) || { modulePath: null, params: {} };
};

const makeResponse = () => {
  const headers = {};
  return {
    statusCode: 200,
    body: "",
    headers,
    setHeader(name, value) {
      headers[String(name).toLowerCase()] = value;
    },
    getHeader(name) {
      return headers[String(name).toLowerCase()];
    },
    end(payload) {
      this.body = payload == null ? "" : String(payload);
    },
  };
};

const main = async () => {
  const raw = await readStdin();
  const input = raw ? JSON.parse(raw) : {};
  const { modulePath, params } = resolveApiRoute(input.url || input.path || "/");

  if (!modulePath) {
    process.stdout.write(JSON.stringify({ ok: false, handled: false, statusCode: 404, error: "route_not_found" }));
    return;
  }

  const handler = require(modulePath);
  if (typeof handler !== "function") {
    process.stdout.write(
      JSON.stringify({ ok: false, handled: true, statusCode: 500, error: "invalid_route_handler", modulePath })
    );
    return;
  }

  const req = {
    method: String(input.method || "GET").toUpperCase(),
    url: String(input.url || input.path || "/"),
    path: String(input.path || ""),
    headers: input.headers && typeof input.headers === "object" ? input.headers : {},
    body: Object.prototype.hasOwnProperty.call(input, "body") ? input.body : undefined,
    query: parseQuery(input.url || input.path || "/"),
    params,
    on(event, cb) {
      if (event === "data") {
        if (typeof input.bodyRaw === "string" && input.bodyRaw) cb(Buffer.from(input.bodyRaw, "utf8"));
        return;
      }
      if (event === "end") {
        cb();
      }
    },
  };

  const res = makeResponse();

  try {
    await handler(req, res);
  } catch (error) {
    if (!res.body) {
      res.statusCode = Number(res.statusCode || 500) || 500;
      res.setHeader("content-type", "application/json");
      res.body = JSON.stringify({
        ok: false,
        error: "local_route_bridge_failure",
        message: String(error && error.message ? error.message : error),
      });
    }
  }

  process.stdout.write(
    JSON.stringify({
      ok: true,
      handled: true,
      modulePath,
      statusCode: Number(res.statusCode || 200) || 200,
      headers: res.headers,
      body: res.body || "",
    })
  );
};

main().catch((error) => {
  process.stdout.write(
    JSON.stringify({
      ok: false,
      handled: true,
      statusCode: 500,
      error: "local_route_bridge_crash",
      message: String(error && error.message ? error.message : error),
    })
  );
  process.exitCode = 1;
});

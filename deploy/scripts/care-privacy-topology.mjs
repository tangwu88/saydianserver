import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const names = {
  api: "/saydian-global-global-api-1",
  worker: "/saydian-global-global-worker-1",
  database: "/saydian-global-global-postgres-1",
};
const environments = (values) =>
  Object.fromEntries(
    (values ?? []).map((value) => [
      value.slice(0, value.indexOf("=")),
      value.slice(value.indexOf("=") + 1),
    ]),
  );
const aliases = (container) =>
  new Set([
    container.Name.slice(1),
    ...Object.values(container.NetworkSettings?.Networks ?? {}).flatMap(
      (network) =>
        [...(network.Aliases ?? []), network.IPAddress].filter(Boolean),
    ),
  ]);
const privateKeys = [
  "NODE_OPTIONS",
  "NODE_PATH",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
];
const parameters = new Set([
  "schema",
  "connection_limit",
  "pool_timeout",
  "connect_timeout",
  "socket_timeout",
  "pgbouncer",
  "statement_cache_size",
  "sslmode",
  "sslaccept",
  "sslcert",
  "sslidentity",
  "sslpassword",
  "application_name",
  "channel_binding",
]);
const command = (value) =>
  value == null || JSON.stringify(value) === '["node","dist/main.js"]'
    ? value
    : ["unproven"];
const entrypoint = (value) =>
  value == null ||
  [
    '["docker-entrypoint.sh"]',
    '["/usr/local/bin/docker-entrypoint.sh"]',
  ].includes(JSON.stringify(value))
    ? value
    : ["unproven"];
function scopedEnvironment(env) {
  const result = {};
  if (env.DATABASE_URL) {
    try {
      const url = new URL(env.DATABASE_URL);
      url.username = "";
      url.password = "";
      for (const key of new Set(url.searchParams.keys()))
        if (key !== "schema") url.searchParams.set(key, "present");
      result.DATABASE_URL = url.href;
    } catch {
      result.DATABASE_URL = "invalid";
    }
  }
  if (env.POSTGRES_DB) result.POSTGRES_DB = env.POSTGRES_DB;
  for (const key of privateKeys) if (env[key]) result[key] = "present";
  return result;
}
export function redactCareInventory(containers) {
  assert(Array.isArray(containers));
  return containers.map((c) => ({
    Name: c.Name,
    Image: c.Image,
    State: { Running: c.State?.Running },
    NetworkSettings: c.NetworkSettings,
    Mounts: c.Mounts?.map((m) => ({ Destination: m.Destination })),
    Config: {
      WorkingDir: c.Config?.WorkingDir,
      Cmd: command(c.Config?.Cmd),
      Entrypoint: entrypoint(c.Config?.Entrypoint),
      Env: Object.entries(scopedEnvironment(environments(c.Config?.Env))).map(
        ([k, v]) => k + "=" + v,
      ),
      Labels: Object.fromEntries(
        ["com.docker.compose.project", "com.docker.compose.service"].map(
          (k) => [k, c.Config?.Labels?.[k]],
        ),
      ),
    },
  }));
}
export function redactCareCompose(compose) {
  assert(compose?.services);
  return {
    services: Object.fromEntries(
      ["api", "worker"].map((role) => {
        const service = compose.services["global-" + role];
        assert(service);
        return [
          "global-" + role,
          {
            command: command(service.command),
            entrypoint: entrypoint(service.entrypoint),
            working_dir: service.working_dir,
            volumes: service.volumes?.map((m) => ({ target: m.target })),
            volumes_from: service.volumes_from?.map(() => ({})),
            configs: service.configs?.map(() => ({})),
            secrets: service.secrets?.map(() => ({})),
            scale: service.scale,
            deploy: { replicas: service.deploy?.replicas },
            environment: scopedEnvironment(service.environment ?? {}),
          },
        ];
      }),
    ),
  };
}
export function assertCareDatabaseScope(api, database) {
  assert(api && database?.State?.Running === true, "Unknown database scope");
  const value = new URL(environments(api.Config?.Env).DATABASE_URL);
  assert(
    ["postgres:", "postgresql:"].includes(value.protocol),
    "Unknown database protocol",
  );
  assert(!value.port || value.port === "5432", "Unknown database listener");
  assert(
    aliases(database).has(value.hostname) &&
      decodeURIComponent(value.pathname.slice(1)) ===
        environments(database.Config?.Env).POSTGRES_DB,
    "Database container differs from live runtime",
  );
  assert(
    value.searchParams.getAll("schema").length <= 1 &&
      (value.searchParams.get("schema") ?? "public") === "public" &&
      !value.searchParams.has("options"),
    "Unknown runtime schema",
  );
  assert(
    [...value.searchParams.keys()].every((key) => parameters.has(key)),
    "Unknown database connection option",
  );
  return value;
}
function safeRuntime(config, mounts = []) {
  assert.deepEqual(
    config.Cmd ?? config.command ?? ["node", "dist/main.js"],
    ["node", "dist/main.js"],
    "Unexpected runtime command",
  );
  const entry = config.Entrypoint ?? config.entrypoint;
  assert(
    entry == null ||
      JSON.stringify(entry) === '["docker-entrypoint.sh"]' ||
      JSON.stringify(entry) === '["/usr/local/bin/docker-entrypoint.sh"]',
    "Unexpected runtime entrypoint",
  );
  const env = Array.isArray(config.Env)
    ? environments(config.Env)
    : (config.environment ?? {});
  for (const key of privateKeys)
    assert(!env[key], "Runtime code injection is not allowed");
  for (const mount of mounts) {
    const destination = mount.Destination ?? mount.target;
    assert(typeof destination === "string", "Unknown runtime mount");
    assert(
      !["/", "/workspace", "/usr", "/lib", "/bin", "/sbin"].some(
        (prefix) =>
          destination === prefix ||
          (prefix !== "/" && destination.startsWith(prefix + "/")),
      ),
      "Runtime code mount is not allowed",
    );
  }
}

export function assertCareTopology(containers, compose, phase, processes = {}) {
  assert(
    ["present", "stopped", "running"].includes(phase) &&
      Array.isArray(containers),
    "Unknown topology state",
  );
  const get = (name) => {
    const rows = containers.filter((c) => c.Name === name);
    assert.equal(rows.length, 1, "Expected exactly one managed container");
    return rows[0];
  };
  const database = get(names.database),
    api = get(names.api),
    worker = get(names.worker);
  assertCareDatabaseScope(api, database);
  assertCareDatabaseScope(worker, database);
  assert(database.State?.Running === true, "Database is not running");
  const dbNames = aliases(database),
    databaseName = environments(database.Config?.Env).POSTGRES_DB;
  assert(databaseName, "Database identity is unknown");
  const url = (container) => {
    const raw = environments(container.Config?.Env).DATABASE_URL;
    assert(raw, "Database client identity is unknown");
    const value = new URL(raw);
    assert(
      ["postgres:", "postgresql:"].includes(value.protocol),
      "Unexpected database protocol",
    );
    return value;
  };
  for (const [role, container] of [
    ["api", api],
    ["worker", worker],
  ]) {
    assert(
      typeof container.State?.Running === "boolean",
      "Unknown container state",
    );
    if (phase !== "present")
      assert.equal(
        container.State.Running,
        phase === "running",
        "Unexpected live instance",
      );
    assert.equal(
      container.Config?.WorkingDir,
      `/workspace/apps/${role}`,
      "Unexpected runtime directory",
    );
    assert(
      /^sha256:[a-f0-9]{64}$/.test(container.Image),
      "Unpinned live image",
    );
    safeRuntime(container.Config, container.Mounts);
    if (container.State.Running)
      assert.equal(
        (processes[role] ?? "")
          .split("\n")
          .filter((line) => /\bnode(?:js)?(?:\s|$)/.test(line)).length,
        1,
        "Expected one Node process",
      );
    const db = url(container);
    assert(
      dbNames.has(db.hostname) &&
        decodeURIComponent(db.pathname.slice(1)) === databaseName,
      "Managed runtime uses an unknown database",
    );
    const service = compose?.services?.[`global-${role}`];
    assert(
      service &&
        (service.scale ?? 1) === 1 &&
        (service.deploy?.replicas ?? 1) === 1,
      "Unknown or scaled runtime service",
    );
    safeRuntime(service, service.volumes);
    assert(
      !service.working_dir || service.working_dir === `/workspace/apps/${role}`,
      "Unexpected intended runtime directory",
    );
    assert(
      !(
        service.volumes_from?.length ||
        service.configs?.length ||
        service.secrets?.length
      ),
      "Indirect runtime mounts cannot be proven",
    );
    assertCareDatabaseScope(
      {
        Config: {
          Env: Object.entries(service.environment ?? {}).map(
            ([key, value]) => key + "=" + value,
          ),
        },
      },
      database,
    );
  }
  const apiNetworks = Object.keys(api.NetworkSettings?.Networks ?? {}),
    apiAliases = aliases(api);
  for (const container of containers) {
    if (
      !container.State?.Running ||
      [api, worker, database].includes(container)
    )
      continue;
    const labels = container.Config?.Labels ?? {};
    assert(
      !(
        ["saydian-global", "saydianapp-production"].includes(
          labels["com.docker.compose.project"],
        ) &&
        /^(global-)?(api|worker)$/.test(
          labels["com.docker.compose.service"] ?? "",
        )
      ),
      "Additional managed runtime",
    );
    if (
      Object.keys(container.NetworkSettings?.Networks ?? {}).some((network) =>
        apiNetworks.includes(network),
      )
    )
      assert(
        ![...aliases(container)].some((alias) => apiAliases.has(alias)),
        "Ambiguous API network alias",
      );
    if (!environments(container.Config?.Env).DATABASE_URL) continue;
    const db = url(container),
      sameName = decodeURIComponent(db.pathname.slice(1)) === databaseName;
    if (!sameName) continue;
    const independent = containers.some(
      (other) =>
        other !== database &&
        environments(other.Config?.Env).POSTGRES_DB &&
        aliases(other).has(db.hostname),
    );
    assert(
      !dbNames.has(db.hostname) && independent,
      "Additional or unproven database client",
    );
  }
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    const [phase, inventory, compose, apiProcesses, workerProcesses] =
      process.argv.slice(2);
    if (phase === "sanitize" || phase === "sanitize-compose") {
      const value = JSON.parse(readFileSync(0, "utf8"));
      console.log(
        JSON.stringify(
          phase === "sanitize"
            ? redactCareInventory(value)
            : redactCareCompose(value),
        ),
      );
    } else if (phase === "database-scope") {
      const rows = JSON.parse(readFileSync(inventory, "utf8"));
      assertCareDatabaseScope(
        rows.find((c) => c.Name === names.api),
        rows.find((c) => c.Name === names.database),
      );
      console.log("care-database-scope-ok");
    } else {
      assertCareTopology(
        JSON.parse(readFileSync(inventory, "utf8")),
        JSON.parse(readFileSync(compose, "utf8")),
        phase,
        {
          api: readFileSync(apiProcesses, "utf8"),
          worker: readFileSync(workerProcesses, "utf8"),
        },
      );
      console.log("care-topology-ok");
    }
  } catch {
    console.error("Care privacy topology cannot be proven.");
    process.exitCode = 1;
  }
}

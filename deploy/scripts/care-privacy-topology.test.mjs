import test from "node:test";
import assert from "node:assert/strict";
import {
  assertCareTopology,
  assertCareDatabaseScope,
  redactCareInventory,
  redactCareCompose,
} from "./care-privacy-topology.mjs";

function fixture() {
  const container = (role, env) => ({
    Name: `/saydian-global-global-${role}-1`,
    Image: "sha256:" + "a".repeat(64),
    State: { Running: true },
    Mounts: [],
    NetworkSettings: {
      Networks: {
        private: {
          Aliases: [`global-${role}`],
          IPAddress: role === "postgres" ? "172.20.0.2" : "172.20.0.3",
        },
      },
    },
    Config: {
      Cmd: ["node", "dist/main.js"],
      WorkingDir: `/workspace/apps/${role}`,
      Env: env,
    },
  });
  const containers = [
    container("postgres", ["POSTGRES_DB=synthetic_test"]),
    ...["api", "worker"].map((role) =>
      container(role, [
        "DATABASE_URL=postgresql://synthetic:synthetic@global-postgres/synthetic_test",
      ]),
    ),
  ];
  return {
    containers,
    compose: {
      services: Object.fromEntries(
        ["api", "worker"].map((role) => [
          "global-" + role,
          {
            command: ["node", "dist/main.js"],
            environment: {
              DATABASE_URL:
                "postgresql://synthetic:synthetic@global-postgres/synthetic_test",
            },
          },
        ]),
      ),
    },
    processes: {
      api: "PID COMMAND\n1 node dist/main.js\n",
      worker: "PID COMMAND\n2 node dist/main.js\n",
    },
  };
}
test("care topology independently checks singleton runtimes and drained state without exposing credentials", () => {
  const f = fixture();
  assert(assertCareTopology(f.containers, f.compose, "running", f.processes));
  f.containers[1].State.Running = false;
  f.containers[2].State.Running = false;
  assert(assertCareTopology(f.containers, f.compose, "stopped", {}));
  assert.throws(() =>
    assertCareTopology(f.containers, f.compose, "running", f.processes),
  );
});
test("inventory evidence strips credentials and unrelated secrets without weakening topology checks", () => {
  const f = fixture();
  f.containers[1].Config.Env.push("ACCESS_TOKEN_SECRET=must-not-persist");
  f.compose.services["global-api"].environment.ACCESS_TOKEN_SECRET =
    "must-not-persist";
  const inventory = redactCareInventory(f.containers),
    compose = redactCareCompose(f.compose);
  assert(!JSON.stringify({ inventory, compose }).includes("must-not-persist"));
  assert(
    !JSON.stringify({ inventory, compose }).includes("synthetic:synthetic"),
  );
  assert(assertCareTopology(inventory, compose, "running", f.processes));
});
test("care topology rejects replicas, extra same-db clients, unknown hosts and Node cluster processes", () => {
  for (const change of [
    (f) => (f.compose.services["global-api"].deploy = { replicas: 2 }),
    (f) => f.containers.push({ ...f.containers[1], Name: "/another-api" }),
    (f) =>
      (f.containers[2].Config.Env = [
        "DATABASE_URL=postgresql://x:x@unproven/synthetic_test",
      ]),
    (f) => (f.processes.api += "3 node dist/main.js\n"),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() =>
      assertCareTopology(f.containers, f.compose, "running", f.processes),
    );
  }
});
test("care topology refuses code mounts, alternate launchers and injected module options in live and intended services", () => {
  for (const change of [
    (f) =>
      (f.containers[1].Mounts = [{ Destination: "/workspace/apps/api/dist" }]),
    (f) =>
      (f.compose.services["global-api"].volumes = [
        { target: "/usr/local/bin/node" },
      ]),
    (f) =>
      f.containers[1].Config.Env.push("NODE_OPTIONS=--require=/old-v1.cjs"),
    (f) => (f.compose.services["global-api"].command = ["node", "old-v1.js"]),
  ]) {
    const f = fixture();
    change(f);
    assert.throws(() =>
      assertCareTopology(f.containers, f.compose, "running", f.processes),
    );
  }
});
test("care schema queries cannot silently inspect a different database or search path", () => {
  for (const value of [
    "postgresql://x:x@unproven/synthetic_test",
    "postgresql://x:x@global-postgres:9999/synthetic_test",
    "postgresql://x:x@global-postgres/other",
    "postgresql://x:x@global-postgres/synthetic_test?schema=private",
    "postgresql://x:x@global-postgres/synthetic_test?schema=public&schema=private",
    "postgresql://x:x@global-postgres/synthetic_test?options=-csearch_path%3Dprivate",
  ]) {
    const f = fixture();
    f.containers[1].Config.Env = ["DATABASE_URL=" + value];
    assert.throws(() =>
      assertCareDatabaseScope(f.containers[1], f.containers[0]),
    );
  }
});

import { expect, it } from "vitest";
import { jstDay, jstRenewalDue, jstRenewalPlan, type JstRenewal } from "./jushuitan-renewal";
const issued = Date.parse("2026-01-01T00:00:00Z");
const state: JstRenewal = { enabled: true, issuedAt: new Date(issued).toISOString(), expiresAt: new Date(issued + 30 * jstDay).toISOString(), nextAttemptAt: jstRenewalPlan(new Date(issued).toISOString(), new Date(issued + 30 * jstDay).toISOString()), status: "READY", message: "" };
it("renews at day27 and never in the first15days even after a premature request", () => {
 expect(Date.parse(state.nextAttemptAt)).toBe(issued + 27 * jstDay);
 expect(jstRenewalDue({ ...state, nextAttemptAt: state.issuedAt }, issued + 15 * jstDay)).toBe("WAIT");
 expect(jstRenewalDue(state, issued + 27 * jstDay)).toBe("DUE");
});
it("halts expired grants and ambiguous crash results instead of rotating again", () => {
 expect(jstRenewalDue(state, issued + 30 * jstDay)).toBe("EXPIRED");
 expect(jstRenewalDue({ ...state, status: "RUNNING", attemptedAt: new Date(issued + 27 * jstDay).toISOString() }, issued + 27 * jstDay + 121000)).toBe("UNCERTAIN");
 expect(jstRenewalDue({ ...state, enabled: false }, issued + 31 * jstDay)).toBe("WAIT");
 expect(() => jstRenewalPlan("invalid", state.expiresAt)).toThrow();
});

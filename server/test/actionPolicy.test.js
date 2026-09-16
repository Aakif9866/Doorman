import { test } from "node:test";
import assert from "node:assert/strict";
import { checkActionAgainstPolicy } from "../src/agent/actionPolicy.js";

const ctx = { evaluation: { score: 8, recommendation: "Interview" }, candidateId: "abc-123", candidateEmail: "abc-123@example.com" };

test("allows a write_to_ats call whose status matches the recommendation", () => {
  const result = checkActionAgainstPolicy("write_to_ats", { candidateId: "abc-123", status: "Interview" }, ctx);
  assert.equal(result.allowed, true);
});

test("rejects a write_to_ats call whose status contradicts the recommendation", () => {
  const result = checkActionAgainstPolicy("write_to_ats", { candidateId: "abc-123", status: "Hired" }, ctx);
  assert.equal(result.allowed, false);
});

test("rejects a write_to_ats call for a different candidateId", () => {
  const result = checkActionAgainstPolicy("write_to_ats", { candidateId: "someone-else", status: "Interview" }, ctx);
  assert.equal(result.allowed, false);
});

test("allows a send_email call addressed to the actual candidate", () => {
  const result = checkActionAgainstPolicy("send_email", { to: "abc-123@example.com", subject: "x", body: "y" }, ctx);
  assert.equal(result.allowed, true);
});

test("rejects a send_email call addressed to a different recipient", () => {
  const result = checkActionAgainstPolicy("send_email", { to: "attacker@evil.example.com", subject: "x", body: "y" }, ctx);
  assert.equal(result.allowed, false);
});

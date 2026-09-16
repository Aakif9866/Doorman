import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewEvaluation } from "../src/agent/reviewGate.js";

test("passes a well-formed, internally consistent evaluation", () => {
  const result = reviewEvaluation({ score: 9, recommendation: "Hire", justification: "8 years owning payments services." });
  assert.equal(result.passed, true);
});

test("fails when no evaluation was produced", () => {
  assert.equal(reviewEvaluation(null).passed, false);
});

test("fails on a non-integer or out-of-range score", () => {
  assert.equal(reviewEvaluation({ score: 11, recommendation: "Hire", justification: "x".repeat(20) }).passed, false);
  assert.equal(reviewEvaluation({ score: 0, recommendation: "Reject", justification: "x".repeat(20) }).passed, false);
  assert.equal(reviewEvaluation({ score: 5.5, recommendation: "Interview", justification: "x".repeat(20) }).passed, false);
});

test("fails on a recommendation outside the allowed set", () => {
  const result = reviewEvaluation({ score: 8, recommendation: "Strongly Hire", justification: "x".repeat(20) });
  assert.equal(result.passed, false);
});

test("fails on a missing or too-short justification", () => {
  assert.equal(reviewEvaluation({ score: 5, recommendation: "Under Review", justification: "" }).passed, false);
  assert.equal(reviewEvaluation({ score: 5, recommendation: "Under Review", justification: "short" }).passed, false);
});

test("fails on an internally inconsistent score/recommendation pair (score 1, Hire)", () => {
  const result = reviewEvaluation({ score: 1, recommendation: "Hire", justification: "x".repeat(20) });
  assert.equal(result.passed, false);
  assert.match(result.reason, /inconsistent/);
});

test("fails on an internally inconsistent score/recommendation pair (score 10, Reject)", () => {
  const result = reviewEvaluation({ score: 10, recommendation: "Reject", justification: "x".repeat(20) });
  assert.equal(result.passed, false);
});

test("allows a reasonable borderline judgment call (score 6, Interview)", () => {
  const result = reviewEvaluation({ score: 6, recommendation: "Interview", justification: "x".repeat(20) });
  assert.equal(result.passed, true);
});

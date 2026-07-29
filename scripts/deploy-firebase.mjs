#!/usr/bin/env node
import { execSync } from "node:child_process";

/**
 * Deploys `main` to Firebase App Hosting. Codifies the manual procedure
 * used throughout this project's development: push main to origin (App
 * Hosting builds from origin, not the local working tree, so uncommitted
 * or unpushed changes never ship), verify the push actually landed, then
 * trigger a manual rollout (auto-rollout is disabled on this backend).
 *
 * Usage: node scripts/deploy-firebase.mjs [backend]
 *   backend defaults to "storimac-web" (this repo's only App Hosting backend).
 */

const BACKEND = process.argv[2] || process.env.FIREBASE_BACKEND || "storimac-web";
const BRANCH = "main";

function run(cmd) {
  console.log(`$ ${cmd}`);
  execSync(cmd, { stdio: "inherit" });
}

function capture(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

function fail(message) {
  console.error(`\nDeploy aborted: ${message}`);
  process.exit(1);
}

const currentBranch = capture("git rev-parse --abbrev-ref HEAD");
if (currentBranch !== BRANCH) {
  fail(`currently on branch "${currentBranch}", expected "${BRANCH}". Run: git checkout ${BRANCH}`);
}

const dirty = capture("git status --porcelain");
if (dirty) {
  console.warn(
    "Warning: uncommitted changes present. They will NOT be deployed " +
      "(App Hosting builds from origin/main, not your working tree):"
  );
  console.warn(dirty);
}

run("git fetch origin");

let localSha = capture(`git rev-parse ${BRANCH}`);
const remoteSha = capture(`git rev-parse origin/${BRANCH}`);

if (localSha !== remoteSha) {
  const behind = Number(capture(`git rev-list --count ${BRANCH}..origin/${BRANCH}`));
  if (behind > 0) {
    fail(`local ${BRANCH} is behind origin/${BRANCH} by ${behind} commit(s). Pull before deploying.`);
  }

  const ahead = capture(`git rev-list --count origin/${BRANCH}..${BRANCH}`);
  console.log(`Local ${BRANCH} is ahead of origin by ${ahead} commit(s) — pushing.`);
  run(`git push origin ${BRANCH}`);

  localSha = capture(`git rev-parse ${BRANCH}`);
  const pushedSha = capture(`git rev-parse origin/${BRANCH}`);
  if (localSha !== pushedSha) {
    fail("origin/main still doesn't match local main after push — something rejected or raced the push.");
  }
}

console.log(`\norigin/${BRANCH} is at ${localSha.slice(0, 7)} — deploying this commit to backend "${BACKEND}".\n`);

run(`npx firebase apphosting:rollouts:create ${BACKEND} --git-branch ${BRANCH} --force`);

console.log(`\nDone. Deployed ${localSha.slice(0, 7)} to "${BACKEND}".`);

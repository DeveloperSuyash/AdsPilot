// lib/ids.js — a stable id for a finding, keyed on project + type + subject, so a re-sync UPDATES the row somebody has already seen and a
// row somebody dismissed stays dismissed. Same formula as SEOPilot's analyze.actionKey.
import crypto from "node:crypto";

export function actionKey(projectId, type, subject) {
  return crypto.createHash("sha1").update(`${projectId}|${type}|${subject}`).digest("hex").slice(0, 16);
}

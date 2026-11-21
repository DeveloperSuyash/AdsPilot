// Loads server/.env BEFORE any other module reads process.env (ES imports are hoisted). Import this FIRST in server.js.
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), "..", ".env") });

import fs from "fs";
import path from "path";
import { AnyContext } from "./types.js";

const CONTEXT_FILE = "context.json";

export function writeContext(dir: string, data: AnyContext): void {
  fs.mkdirSync(dir, { recursive: true });
  const filePath = path.join(dir, CONTEXT_FILE);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

export function readContext(dir: string): AnyContext {
  const filePath = path.join(dir, CONTEXT_FILE);
  if (!fs.existsSync(filePath)) {
    throw new Error(`No context.json found in ${dir}`);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const parsed = AnyContext.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new Error(`Invalid context.json in ${dir}: ${parsed.error.message}`);
  }
  return parsed.data;
}

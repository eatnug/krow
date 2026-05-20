#!/usr/bin/env node

import { main } from "./cli.js";

try {
  main(process.argv);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

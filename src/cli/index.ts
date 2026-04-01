#!/usr/bin/env node

import { Command } from "commander";
import { enrichCommand } from "./commands/enrich.js";
import { fingerprintCommand } from "./commands/fingerprint.js";
import { fixCommand } from "./commands/fix.js";
import { initCommand } from "./commands/init.js";
import { listCommand } from "./commands/list.js";
import { reportCommand } from "./commands/report.js";
import { scanCommand } from "./commands/scan.js";
import { sweepCommand } from "./commands/sweep.js";
import { uiCommand } from "./commands/ui.js";

const program = new Command();

program
  .name("kaicho")
  .description("Run AI coding agents against repos and collect structured suggestions")
  .version("0.1.0");

program.addCommand(enrichCommand);
program.addCommand(fingerprintCommand);
program.addCommand(fixCommand);
program.addCommand(initCommand);
program.addCommand(listCommand);
program.addCommand(reportCommand);
program.addCommand(scanCommand);
program.addCommand(sweepCommand);
program.addCommand(uiCommand);

program.parse();

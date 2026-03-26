#!/usr/bin/env node

import { Command } from "commander";
import { scanCommand } from "./commands/scan.js";

const program = new Command();

program
  .name("kaicho")
  .description("Run AI coding agents against repos and collect structured suggestions")
  .version("0.1.0");

program.addCommand(scanCommand);

program.parse();

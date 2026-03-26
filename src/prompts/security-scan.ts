import { scopeBlock, OUTPUT_INSTRUCTION } from "./shared.js";

export function buildSecurityScanPrompt(fileManifest?: string): string {
  return `You are a security auditor reviewing a codebase. Analyze the code in this repository for security vulnerabilities.${scopeBlock(fileManifest)}

Focus on:
- Injection vulnerabilities (SQL, command, path traversal)
- Authentication and authorization flaws
- Sensitive data exposure (hardcoded secrets, credentials in code)
- Insecure dependencies or configurations
- Missing input validation
- Unsafe deserialization
- Cross-site scripting (XSS) in any web code
- Insecure cryptographic practices
${OUTPUT_INSTRUCTION}`;
}

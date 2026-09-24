# Security Policy

## Reporting a vulnerability

Please report security issues privately, using GitHub Security Advisories:
open the **Security** tab on this repository and choose **Report a
vulnerability**. Do not open a public issue for anything in scope below —
a public issue gives an active exploit a head start before there's a fix.

## Scope

Localvert's entire premise is that files never leave the browser. Anything
that undermines that is treated as critical, regardless of how small it looks:

- Any way for file data, or bytes derived from a file, to leave the device —
  a network request, a beacon, anything that reaches `connect-src` beyond
  `'self'`.
- Any bypass of the Content-Security-Policy that makes upload physically
  impossible, or of the COOP/COEP headers the app depends on.
- Supply-chain issues in a bundled WebAssembly conversion engine — a
  compromised build, a malicious dependency, a codec that does something its
  license and documentation don't describe.
- Anything that lets a converted file, or a crafted input file, execute code
  outside its worker's sandbox.

Ordinary bugs — a conversion producing a wrong or corrupted output, a UI
glitch, a broken link — are not security issues. Please file those as a
regular [bug report](.github/ISSUE_TEMPLATE/bug_report.yml) instead.

## Response

This is a small, early-stage project maintained by one person. There's no
formal SLA, but security reports get priority over everything else in the
queue.

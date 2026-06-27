# Security Policy

selbstbehalt handles sensitive personal and health-related data (Art. 9 DSGVO).
We take security and privacy seriously and appreciate responsible disclosure.

## Reporting a vulnerability

**Please do not report security vulnerabilities through public GitHub issues,
discussions, or pull requests.**

Instead, report privately via GitHub's
[private vulnerability reporting](https://github.com/justb81/selbstbehalt/security/advisories/new)
("Report a vulnerability" under the repository's **Security** tab). If that is
unavailable to you, contact the maintainer [@justb81](https://github.com/justb81)
privately to arrange a disclosure channel.

Please include:

- A description of the vulnerability and its impact.
- Steps to reproduce, or a proof of concept.
- Affected version / commit and deployment setup, if relevant.
- **Do not include real invoice images, health data, or other sensitive
  personal information** in your report — use synthetic data to demonstrate.

## What to expect

- We aim to acknowledge a report within a few days.
- We'll keep you informed about the fix and coordinate a disclosure timeline.
- With your consent, we're happy to credit you once the issue is resolved.

## Scope

This is a self-hostable application. The most security-relevant areas are:

- The backend REST API and its authentication (reverse-proxy Basic Auth /
  optional `X-API-Key`).
- The client-side OCR pipeline and the boundary that keeps invoice images on the
  device (no images may be sent to the backend).
- Database export/import (`/api/export/db`, `/api/import/db`).

Issues that depend on a misconfigured reverse proxy or an attacker who already
has full control of the host are generally out of scope, but feel free to report
if you're unsure.

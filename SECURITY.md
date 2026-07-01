# Security Policy

## Reporting a Vulnerability

Please **do not** open a public issue for security vulnerabilities.

Instead, report privately using GitHub's **"Report a vulnerability"** feature
under the repository's **Security** tab
(https://github.com/KnockOutEZ/wigolo/security/advisories/new). This creates a
private advisory visible only to you and the maintainers.

Please include:

- A description of the vulnerability and its impact
- Steps to reproduce (a minimal proof of concept if possible)
- Affected version(s) and environment

You can expect an initial response within a few days. We'll work with you on a
fix and coordinate disclosure once a patch is available.

## Scope notes

wigolo is local-first and runs on the user's own machine. Areas of particular
interest for reports:

- The optional watch/webhook subsystem (SSRF protections, URL validation)
- Credential handling for optional cloud LLM keys (OS keychain / encrypted file)
- Any path where fetched or crawled remote content could affect the host

## Supported Versions

During the public beta, security fixes target the **latest published release**.
Please upgrade to the latest version before reporting.

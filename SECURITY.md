# Security policy

Please do not disclose vulnerabilities, credentials, private student data, or
recordings in a public issue.

Report a suspected vulnerability privately through GitHub's security advisory
feature for this repository. Include affected versions, reproduction steps, and
the expected impact, but do not include real children's data or active API keys.

Before deploying publicly:

- use HTTPS;
- keep `.env` and `server/data/` outside version control;
- use unique provider credentials with the minimum required permissions;
- configure authentication host and cookie settings for your own domain;
- list every trusted browser origin explicitly with `CORS_ALLOWED_ORIGINS`;
- trust only the exact reverse-proxy subnet, such as `HTTP_TRUST_PROXY=loopback`;
- back up SQLite data before migrations;
- review retention and consent requirements for children's recordings.

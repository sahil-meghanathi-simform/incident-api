# API reference

Generated from the Zod schemas in `src/contracts/` as each module lands. Status:
pending — only `GET /api/v1/health` exists as of Module 0.

## `GET /api/v1/health`

Public, no authentication. Mounted before any `authenticate` middleware is applied
anywhere in the app — required by the compose healthcheck and the
`api → migrate-seed` `depends_on` chain.

```jsonc
// 200
{ "status": "ok", "dbLatencyMs": 3, "contractVersion": "0.1.0" }
```

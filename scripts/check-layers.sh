#!/usr/bin/env bash
# Belt-and-braces CI check, independent of ESLint config drift (build-plan.md B1/B6).
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

# 1. prisma.incident may appear only in incident.repository.ts (the actor-scoped
#    repository) and src/jobs/ (the escalation job's system-level scan, which is
#    deliberately NOT actor-scoped — see the comment at its call site).
offenders=$(grep -rn --include='*.ts' 'prisma\.incident\b' src/ \
  | grep -v 'src/modules/incidents/incident.repository.ts' \
  | grep -v 'src/jobs/' || true)
if [ -n "$offenders" ]; then
  echo "FAIL: prisma.incident used outside incident.repository.ts / src/jobs/:"
  echo "$offenders"
  fail=1
fi

# 2. req.query may only be read in validate.middleware.ts.
offenders=$(grep -rn --include='*.ts' 'req\.query\b' src/ \
  | grep -v 'src/http/middleware/validate.middleware.ts' || true)
if [ -n "$offenders" ]; then
  echo "FAIL: req.query read outside validate.middleware.ts:"
  echo "$offenders"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "PASS: layering rules hold"
fi
exit $fail

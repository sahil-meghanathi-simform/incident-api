#!/bin/sh
set -e
echo "DEBUG pwd: $(pwd)"
echo "DEBUG ls /app:"
ls -la /app
echo "DEBUG ls /app/dist:"
ls -la /app/dist || echo "no dist dir"
npx prisma migrate deploy
exec node dist/main.js

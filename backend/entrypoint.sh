#!/bin/sh
set -e

echo "Running database migrations..."
npx prisma db push --skip-generate
echo "Database ready."

echo "Starting application..."
exec node dist/index.js

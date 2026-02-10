#!/bin/sh
set -e

# Copy schema into the mounted volume (./data:/app/prisma)
# The volume mount hides the built-in schema, so we restore it
cp /app/prisma-schema/schema.prisma /app/prisma/schema.prisma

echo "Running database migrations..."
npx prisma db push --skip-generate --schema /app/prisma/schema.prisma
echo "Database ready."

echo "Starting application..."
exec node dist/index.js

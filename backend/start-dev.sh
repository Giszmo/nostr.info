#!/bin/bash

# Quick start script for development

echo "🚀 Starting Nostr.info Backend in development mode..."

# Start PostgreSQL and Redis
echo "📦 Starting PostgreSQL and Redis..."
docker-compose up -d postgres redis

# Wait for services
sleep 3

# Run migrations if needed
echo "📊 Ensuring database schema is up to date..."
npm run db:migrate

# Start both services concurrently
echo "🔥 Starting collector and API server..."

# Run in background
npm run start:collector & COLLECTOR_PID=$!
npm run start:api & API_PID=$!

echo ""
echo "✅ Services started!"
echo "   Collector PID: $COLLECTOR_PID"
echo "   API Server PID: $API_PID"
echo ""
echo "API: http://localhost:3000"
echo "Health: http://localhost:3000/health"
echo "Docs: http://localhost:3000/api/v1/docs"
echo ""
echo "Press Ctrl+C to stop"
echo ""

# Handle Ctrl+C
trap "kill $COLLECTOR_PID $API_PID; exit" INT

# Wait for processes
wait $COLLECTOR_PID $API_PID

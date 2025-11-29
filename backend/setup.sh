#!/bin/bash

# Setup script for Nostr.info Backend

set -e

echo "🚀 Setting up Nostr.info Backend..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
    exit 1
fi

echo "✓ Node.js $(node --version) found"

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is not installed. Please install Docker first."
    exit 1
fi

echo "✓ Docker $(docker --version | cut -d' ' -f3) found"

# Install dependencies
echo "📦 Installing dependencies..."
npm install

# Create .env file if it doesn't exist
if [ ! -f .env ]; then
    echo "📝 Creating .env file..."
    cp .env.example .env
    echo "✓ .env file created. Please edit it with your configuration."
fi

# Start PostgreSQL and Redis with Docker
echo "🐘 Starting PostgreSQL and Redis..."
docker-compose up -d postgres redis

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
until docker-compose exec -T postgres pg_isready -U nostr &> /dev/null; do
    sleep 1
done

echo "✓ PostgreSQL is ready"

# Wait for Redis to be ready
echo "⏳ Waiting for Redis to be ready..."
until docker-compose exec -T redis redis-cli ping &> /dev/null; do
    sleep 1
done

echo "✓ Redis is ready"

# Run migrations
echo "📊 Running database migrations..."
npm run db:migrate

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "  1. Edit .env file with your configuration"
echo "  2. Start the collector: npm run start:collector"
echo "  3. Start the API server: npm run start:api"
echo ""
echo "Or start everything with Docker:"
echo "  docker-compose up -d"
echo ""
echo "API will be available at: http://localhost:3000"
echo "API documentation: http://localhost:3000/api/v1/docs"
echo ""

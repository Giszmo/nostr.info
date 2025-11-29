#!/bin/bash
set -e

# Pull latest code
git pull origin master

git submodule update --init --recursive
echo "✅ Git submodules initialized - _nostrResources/data available"

# Build frontend (Jekyll + charts)
bundle install
bundle exec jekyll build

npm install
npm run build:charts

# Deploy frontend to Nginx folder
cp -r _site/* /var/www/stage.nostr.info/

# Copy _nostrResources to Nginx folder
cp -r _nostrResources /var/www/stage.nostr.info/_nostrResources

# Go to backend folder
cd backend

# Stop and clean old containers and images
docker-compose down
docker rm $(docker ps -aq) 2>/dev/null || true
docker rmi $(docker images -q) 2>/dev/null || true
docker system prune -a --volumes -f -f

# Build fresh backend images
docker-compose build --no-cache

# Start backend containers
docker-compose up -d

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 10

# Run migrations INSIDE the container
echo "📦 Running database migrations..."
docker-compose exec -T api npm run db:migrate

# Back to root directory
cd ..
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Deploy complete! Frontend updated and backend migrated."

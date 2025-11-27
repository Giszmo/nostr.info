#!/bin/bash
set -e

# Pull latest code
git pull origin master

# Build frontend (Jekyll + charts)
bundle install
bundle exec jekyll build

npm install
npm run build:charts

# Deploy frontend to Nginx folder
cp -r _site/* /var/www/stage.nostr.info/

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

npm install
npm run db:migrate


# Test Nginx config and restart
sudo nginx -t
sudo systemctl restart nginx

echo "✅ Deploy complete! Frontend updated and backend migrated."

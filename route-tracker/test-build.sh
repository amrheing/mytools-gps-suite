#!/bin/bash

# Route Tracker Build and Test Script
# Usage: ./test-build.sh

set -e

echo "🚀 Route Tracker - Build and Test Script"
echo "======================================="

# Check if we're in the right directory
if [ ! -f "Dockerfile" ]; then
    echo "❌ Error: Please run this script from the route-tracker directory"
    exit 1
fi

echo "📁 Checking files..."
required_files=("index.html" "script.js" "user-manager.js" "export-manager.js" "Dockerfile" "README.md")

for file in "${required_files[@]}"; do
    if [ -f "$file" ]; then
        echo "✅ $file"
    else
        echo "❌ Missing: $file"
        exit 1
    fi
done

echo ""
echo "🔨 Building Docker image..."
docker build -t route-tracker-test . || {
    echo "❌ Docker build failed"
    exit 1
}

echo ""
echo "🧪 Testing container..."
container_id=$(docker run -d -p 6051:80 route-tracker-test)

# Wait for container to start
sleep 3

# Test if the service is responding  
if curl -f -s http://localhost:6051 > /dev/null; then
    echo "✅ Container is running and responding"
else
    echo "❌ Container health check failed"
    docker logs $container_id
    docker stop $container_id
    docker rm $container_id
    exit 1
fi

echo ""
echo "🧹 Cleaning up test container..."
docker stop $container_id
docker rm $container_id

echo ""
echo "🎉 All tests passed! Route Tracker is ready to deploy."
echo ""
echo "📋 Next steps:"
echo "  1. Start with docker-compose: docker-compose up -d route-tracker"
echo "  2. Access at: http://localhost:6050"
echo "  3. Allow location permissions when prompted"
echo "  4. Create an account and start tracking!"
echo ""
echo "📚 Documentation:"
echo "  • README.md - Complete documentation"
echo "  • QUICKSTART.md - Quick start guide"
echo ""
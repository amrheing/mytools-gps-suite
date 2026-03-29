#!/bin/bash

# MyTools Docker Container Deployment Script
echo "🚀 Starting MyTools Docker Containers..."

# Navigate to container directory
cd /opt/containerd/myTools

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

# Check if docker compose is available
if ! docker compose version > /dev/null 2>&1; then
    echo "❌ docker compose is not available. Please install Docker Compose V2."
    exit 1
fi

# Create data directories if they don't exist
echo "📁 Creating data directories..."
mkdir -p extract-gpx-parts/data/{uploads,processed}

# Stop existing containers if running
echo "🔄 Stopping existing containers..."
docker compose down

# Build and start containers
echo "🔨 Building and starting containers..."
docker compose up -d --build

# Wait a moment for containers to start
sleep 5

# Show container status
echo "📊 Container Status:"
docker compose ps

echo ""
echo "✅ MyTools deployment complete!"
echo ""
echo "🌐 Service URLs:"
echo "   • Google GPX Converter:  http://localhost:6010"
echo "   • Extract GPX Parts:     http://localhost:6020"
echo "   • Export POIs by Pattern: http://localhost:6030" 
echo "   • GPX to KML Converter:   http://localhost:6040"
echo ""
echo "📁 Persistent Data:"
echo "   • GPX Uploads:    /opt/containerd/myTools/extract-gpx-parts/data/uploads"
echo "   • GPX Processed:  /opt/containerd/myTools/extract-gpx-parts/data/processed"
echo ""
echo "🔧 Management Commands:"
echo "   • Stop containers:    docker compose down"
echo "   • View logs:          docker compose logs -f"
echo "   • Restart:            docker compose restart"

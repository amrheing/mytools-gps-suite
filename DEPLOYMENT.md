# Deployment Guide

This guide covers deployment of the MyTools GPS Suite in various environments.

## Quick Deployment

### Standard Docker Deployment

```bash
# Clone repository
git clone https://github.com/your-username/mytools-gps-suite.git
cd mytools-gps-suite

# Deploy containers
chmod +x deploy.sh
./deploy.sh
```

**Access URLs:**
- Google GPX Converter: http://localhost:6010
- Extract GPX Parts: http://localhost:6020

## Production Deployment

### Prerequisites

- **System Requirements:**
  - Linux server (Ubuntu 20.04+ recommended)
  - 4GB+ RAM
  - 10GB+ available disk space
  - Docker with Compose plugin
  - Ports 6010, 6020 available

- **Network Requirements:**
  - Outbound internet access for Docker image pulls
  - Inbound access on ports 6010, 6020 (or your chosen ports)

### Installation Steps

1. **System Preparation:**
```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh

# Add user to docker group
sudo usermod -aG docker $USER
newgrp docker

# Install Docker Compose plugin (if not included)
sudo apt install docker-compose-plugin
```

2. **Directory Setup:**
```bash
# Create deployment directory
sudo mkdir -p /opt/containerd
cd /opt/containerd

# Clone repository
git clone https://github.com/your-username/mytools-gps-suite.git myTools
cd myTools

# Set permissions
sudo chown -R $USER:docker /opt/containerd/myTools
sudo find /opt/containerd/myTools -type d -exec chmod 2775 {} \;
sudo find /opt/containerd/myTools -type f -exec chmod 664 {} \;
sudo chmod +x deploy.sh
```

3. **Deploy Services:**
```bash
./deploy.sh
```

## Custom Configuration

### Port Customization

Edit `docker-compose.yml` to change exposed ports:

```yaml
services:
  google-gpx-converter:
    ports:
      - "8010:80"  # Change 6010 to your preferred port
  
  extract-gpx-parts:
    ports:
      - "8020:80"  # Change 6020 to your preferred port
```

### Storage Configuration

By default, persistent data is stored in:
- `/opt/containerd/myTools/extract-gpx-parts/data/uploads`
- `/opt/containerd/myTools/extract-gpx-parts/data/processed`

To use external storage:

```yaml
services:
  extract-gpx-parts:
    volumes:
      - /my/custom/uploads:/app/web/uploads
      - /my/custom/processed:/app/web/processed
```

### Environment Variables

Configure applications via environment variables:

```yaml
services:
  extract-gpx-parts:
    environment:
      - FLASK_ENV=production
      - PORT=80
      - MAX_CONTENT_LENGTH=104857600  # 100MB
      - UPLOAD_FOLDER=/app/web/uploads
      - PROCESSED_FOLDER=/app/web/processed
```

## Reverse Proxy Setup

### Nginx Configuration

For production deployment behind Nginx:

```nginx
# /etc/nginx/sites-available/mytools
server {
    listen 80;
    server_name yourdomain.com;

    # Google GPX Converter
    location /gpx-converter/ {
        proxy_pass http://localhost:6010/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    # Extract GPX Parts
    location /gpx-extractor/ {
        proxy_pass http://localhost:6020/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        client_max_body_size 100M;
    }
}
```

Enable the site:
```bash
sudo ln -s /etc/nginx/sites-available/mytools /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

### Traefik Configuration

For automatic SSL with Traefik (labels already included in docker-compose.yml):

```yaml
version: '3.8'

services:
  traefik:
    image: traefik:v2.10
    command:
      - "--api.insecure=true"
      - "--providers.docker=true"
      - "--entrypoints.web.address=:80"
      - "--entrypoints.websecure.address=:443"
      - "--certificatesresolvers.letsencrypt.acme.email=your-email@domain.com"
      - "--certificatesresolvers.letsencrypt.acme.storage=/acme.json"
      - "--certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web"
    ports:
      - "80:80"
      - "443:443"
      - "8080:8080"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./acme.json:/acme.json
    networks:
      - mytools-network

  # Your existing services here...
```

## Monitoring & Maintenance

### Health Checks

Add health checks to docker-compose.yml:

```yaml
services:
  google-gpx-converter:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 30s
      timeout: 10s
      retries: 3

  extract-gpx-parts:
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost/"]
      interval: 30s
      timeout: 10s
      retries: 3
```

### Logging

Configure log rotation:

```yaml
services:
  extract-gpx-parts:
    logging:
      driver: "json-file"
      options:
        max-size: "10m"
        max-file: "3"
```

### Backup Strategy

```bash
#!/bin/bash
# backup.sh - Backup script for MyTools data

BACKUP_DIR="/backup/mytools/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$BACKUP_DIR"

# Backup persistent data
cp -r /opt/containerd/myTools/extract-gpx-parts/data "$BACKUP_DIR/"

# Backup configuration
cp /opt/containerd/myTools/docker-compose.yml "$BACKUP_DIR/"

# Create archive
tar -czf "$BACKUP_DIR.tar.gz" -C "$(dirname "$BACKUP_DIR")" "$(basename "$BACKUP_DIR")"
rm -rf "$BACKUP_DIR"

echo "Backup created: $BACKUP_DIR.tar.gz"
```

### Auto-cleanup Script

```bash
#!/bin/bash
# cleanup.sh - Clean old uploaded files

find /opt/containerd/myTools/extract-gpx-parts/data/uploads -type f -mtime +7 -delete
find /opt/containerd/myTools/extract-gpx-parts/data/processed -type f -mtime +7 -delete

# Clean Docker
docker system prune -f
docker image prune -f
```

Add to crontab:
```bash
# Clean up weekly
0 2 * * 0 /opt/containerd/myTools/cleanup.sh
```

## Scaling & Performance

### Resource Limits

Set container resource limits:

```yaml
services:
  extract-gpx-parts:
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'
```

### Multiple Instances

For high availability, deploy multiple instances:

```yaml
services:
  extract-gpx-parts:
    deploy:
      replicas: 3
    ports:
      - "6020-6022:80"
```

## Security Considerations

### File Upload Limits

Configure upload restrictions:

```yaml
services:
  extract-gpx-parts:
    environment:
      - MAX_CONTENT_LENGTH=104857600  # 100MB limit
```

### Network Security

Use Docker networks for isolation:

```yaml
networks:
  mytools-network:
    driver: bridge
    internal: true  # No external access
  web-network:
    driver: bridge  # External access for reverse proxy
```

### Access Control

For internal deployment, add basic auth:

```nginx
location /gpx-extractor/ {
    auth_basic "Restricted Access";
    auth_basic_user_file /etc/nginx/.htpasswd;
    proxy_pass http://localhost:6020/;
}
```

## Troubleshooting

### Common Issues

**Port Conflicts:**
```bash
# Check port usage
sudo netstat -tlnp | grep -E ':601[0-9]'

# Kill conflicting processes
sudo fuser -k 6010/tcp 6020/tcp
```

**Container Build Failures:**
```bash
# Clean build cache
docker system prune -a
docker compose build --no-cache
```

**Permission Issues:**
```bash
# Fix permissions
sudo chown -R $USER:docker /opt/containerd/myTools
sudo chmod -R 775 /opt/containerd/myTools
```

**Storage Full:**
```bash
# Check disk usage
df -h /opt/containerd

# Clean old files
find /opt/containerd/myTools/extract-gpx-parts/data -type f -mtime +1 -delete
```

### Log Analysis

```bash
# View container logs
docker compose logs -f extract-gpx-parts
docker compose logs -f google-gpx-converter

# System logs
journalctl -u docker -f
```

## Updates & Maintenance

### Application Updates

```bash
# Pull latest changes
git pull origin main

# Rebuild and restart
docker compose down
docker compose up -d --build
```

### Docker Updates

```bash
# Update Docker
sudo apt update && sudo apt upgrade docker-ce docker-ce-cli

# Update base images
docker compose pull
docker compose up -d
```

---

For additional support, please refer to the main [README.md](README.md) or create an issue on GitHub.
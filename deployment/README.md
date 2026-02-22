# Deployment Configurations

This directory contains various deployment configurations for the GPS Tools Suite.

## Deployment Options

### Option 1: Standalone Deployment (Recommended)

Use the standalone deployment for a simple, self-contained setup:

```bash
# Start the applications
cd deployment
docker compose -f docker-compose-tools.yml up -d

# Your apps will be available at:
# http://localhost:6010 - Google GPX Converter
# http://localhost:6020 - Extract GPX Parts
```

### Option 2: MailCow Integration (Advanced)

For integration with an existing MailCow mail server setup:

1. **Copy MailCow configuration**:
   ```bash
   cp mailcow-tools.conf /opt/mailcow-dockerized/data/conf/nginx/
   ```

2. **Restart MailCow nginx**:
   ```bash
   cd /opt/mailcow-dockerized
   docker compose restart nginx-mailcow
   ```

3. **Add DNS record**:
   ```
   tools.yourdomain.com CNAME yourdomain.com
   ```

4. **Start the GPS applications** (using standalone docker-compose):
   ```bash
   cd /path/to/mytools-gps-suite
   docker compose up -d
   ```

### Option 3: Standalone Web Server

If you want to use your own nginx or apache setup:

1. **Use the nginx configuration template** (`nginx-tools.conf`)
2. **Adapt the SSL certificate paths** and upstream server IPs
3. **Start the GPS applications** on ports 6010/6020

## Configuration Files

- `docker-compose-tools.yml` - Standalone Docker Compose setup
- `nginx-tools.conf` - Generic nginx configuration template  
- `mailcow-tools.conf` - MailCow-specific nginx configuration
- `README.md` - This deployment guide

## Network Requirements

- **Port 6010**: Google GPX Converter (nginx serving static files)
- **Port 6020**: Extract GPX Parts (Flask web application)
- **Ports 80/443**: Web server for reverse proxy (if using subdomain setup)

## SSL Certificates

The configurations expect SSL certificates. Update the paths in the nginx configs:

- **Generic setup**: `/etc/ssl/certs/yourdomain.crt` and `/etc/ssl/private/yourdomain.key`
- **MailCow setup**: Uses existing MailCow certificates automatically

## Customization

1. **Domain name**: Replace `tools.amrhein.info` with your subdomain
2. **Network IPs**: Adjust `172.22.1.1` to your Docker host IP if needed
3. **Ports**: Change exposed ports if 6010/6020 are in use
4. **SSL paths**: Update certificate locations for your environment

## Troubleshooting

- **Bad Gateway**: Check that GPS apps are running on ports 6010/6020
- **CSS not loading**: Verify the `/static/` location block is properly configured
- **SSL errors**: Ensure certificate paths exist and are readable by nginx

## Health Check

Test your deployment:
```bash
# Check applications are running
docker ps | grep -E "google-gpx|extract-gpx"

# Test direct access
curl -I http://localhost:6010
curl -I http://localhost:6020

# Test proxy (if using subdomain)
curl -I https://tools.yourdomain.com/health
```
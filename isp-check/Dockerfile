# Package the desktop app as one runnable file (Python zipapp)
FROM python:3-alpine AS package
COPY isp-connection-check/__main__.py isp-connection-check/pingmon.py isp-connection-check/pingmon_gui.py /src/
RUN python -m zipapp /src -p "/usr/bin/env python3" -o /isp-connection-check.pyz

# Use nginx to serve static files
FROM nginx:alpine

# Copy the tool files to the nginx web directory
COPY index.html /usr/share/nginx/html/
COPY README.md /usr/share/nginx/html/
COPY --from=package /isp-connection-check.pyz /usr/share/nginx/html/download/

# Create shared directory (will be mounted as volume)
RUN mkdir -p /usr/share/nginx/html/shared

# Configure nginx for single page application
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]

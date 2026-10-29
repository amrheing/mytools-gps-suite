# Package the desktop app as one runnable file (Python zipapp)
FROM python:3.13-alpine AS package
COPY isp-connection-check/__main__.py isp-connection-check/pingmon.py isp-connection-check/pingmon_gui.py /src/
RUN mkdir -p /out && python -m zipapp /src -p "/usr/bin/env python3" -o /out/isp-connection-check.pyz
# Checksum shown on the download page, so users can verify the file before running it
RUN cd /out && sha256sum isp-connection-check.pyz > isp-connection-check.pyz.sha256

# Use nginx to serve static files (same pinned image as the other containers on this server)
FROM nginx:1.27-alpine

COPY index.html /usr/share/nginx/html/
COPY --from=package /out/ /usr/share/nginx/html/download/

# Shared styles are mounted as a read-only volume
RUN mkdir -p /usr/share/nginx/html/shared

COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

HEALTHCHECK --interval=60s --timeout=5s --retries=3 CMD wget -q --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]

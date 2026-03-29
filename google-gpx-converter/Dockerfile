# Google GPX Converter - Static Web Application
FROM nginx:alpine

# Copy application files (excluding styles.css as we use shared styles)
COPY index.html script.js url-expander.js README.md /usr/share/nginx/html/

# Create shared directory (will be mounted as volume)
RUN mkdir -p /usr/share/nginx/html/shared

# Create nginx config for the application
RUN echo 'server { \
    listen 80; \
    server_name localhost; \
    root /usr/share/nginx/html; \
    index index.html; \
    location / { \
        try_files $uri $uri/ /index.html; \
    } \
    # Enable CORS for API calls \
    location ~* \.(js|css|html)$ { \
        add_header Access-Control-Allow-Origin *; \
        add_header Access-Control-Allow-Methods "GET, POST, OPTIONS"; \
        add_header Access-Control-Allow-Headers "Content-Type"; \
    } \
}' > /etc/nginx/conf.d/default.conf

# Expose port 80 (will be mapped to 6010)
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
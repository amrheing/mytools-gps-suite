# Use nginx to serve static files
FROM nginx:alpine

# Copy the tool files to the nginx web directory
COPY index.html /usr/share/nginx/html/
COPY script.js /usr/share/nginx/html/
COPY README.md /usr/share/nginx/html/

# Create shared directory (will be mounted as volume)
RUN mkdir -p /usr/share/nginx/html/shared

# Configure nginx for single page application
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Expose port 80
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
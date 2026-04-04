# Route Tracker - GPS Data Receiver with Node.js Backend
FROM node:18-alpine

# Install curl for health checks
RUN apk add --no-cache curl

# Set working directory
WORKDIR /app

# Copy package files first for better layer caching
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --omit=dev

# Copy application files
COPY server.js ./
COPY index.html script.js user-manager.js export-manager.js login.html admin.html README.md QUICKSTART.md ./

# Create shared directory (will be mounted as volume for shared styles)
RUN mkdir -p ./shared

# Create data directories with proper permissions
RUN mkdir -p /app/data/routes /app/data/devices && \
    chown -R node:node /app/data

# Copy static files to a location the server can serve
RUN mkdir -p /usr/share/nginx/html && \
    cp index.html script.js user-manager.js export-manager.js login.html admin.html README.md QUICKSTART.md /usr/share/nginx/html/

# Expose port 3000 (will be mapped to 6050)
EXPOSE 3000

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000
ENV ADMIN_PASSWORD=admin123

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:3000/api/health || exit 1

# Switch to non-root user for security
USER node

# Start the Node.js server
CMD ["node", "server.js"]
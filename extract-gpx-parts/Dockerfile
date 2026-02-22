# Extract GPX Parts - Python Flask Application
FROM python:3.13-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY web/requirements.txt /app/
RUN pip install --no-cache-dir -r requirements.txt

# Copy application files
COPY . /app/

# Create necessary directories for persistent data
RUN mkdir -p /app/data/uploads /app/data/processed /app/web/uploads /app/web/processed

# Set environment variables
ENV FLASK_APP=web/app.py
ENV FLASK_ENV=production
ENV PYTHONPATH=/app

# Change to web directory for Flask app
WORKDIR /app/web

# Expose port 80 (will be mapped to 6020)
EXPOSE 80

# Start the Flask application
CMD ["python", "app.py"]
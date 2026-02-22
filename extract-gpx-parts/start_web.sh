#!/bin/bash
# GPX Extractor Web Interface Launcher

echo "🚀 Starting GPX Extractor Web Interface..."

# Navigate to web directory
cd "$(dirname "$0")/web"

# Check if virtual environment exists
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
    source venv/bin/activate
    pip install flask werkzeug
else
    source venv/bin/activate
fi

# Start the application
echo "🌐 Launching web interface..."
python app.py
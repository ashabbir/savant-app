#!/bin/bash
# Savant Server Dev Start Script

# Exit on any error
set -e

# Change to the server directory
cd "$(dirname "$0")"

# Create .venv if it doesn't exist
if [ ! -d ".venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv .venv
fi

# Activate virtual environment
source .venv/bin/activate

# Install dependencies (prefer dev requirements if available)
if [ -f "requirements-dev.txt" ]; then
    echo "Installing dev dependencies..."
    pip install -r requirements-dev.txt
else
    echo "Installing standard dependencies..."
    pip install -r requirements.txt
fi

# Start the Flask Server
echo "Starting Savant Flask Server..."
python app.py

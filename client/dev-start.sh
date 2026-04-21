#!/bin/bash
# Savant Client Dev Start Script

# Exit on any error
set -e

# Change to the client directory
cd "$(dirname "$0")"

# Install NPM dependencies
echo "Installing client dependencies..."
npm install

# Set the server URL for the client to connect to
export SAVANT_SERVER_URL=http://127.0.0.1:8090

# Start Electron in development mode
echo "Starting Savant Electron Client (Dev Mode)..."
npm run dev

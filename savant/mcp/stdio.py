"""
Unified STDIO entry point for Savant MCP servers.
Used primarily by AI tools that do not support SSE (like Codex).

Usage:
  python3 stdio.py <server_name> [args...]

Example:
  python3 stdio.py workspace
"""

import os
import sys
import subprocess

# Map of server names to their filenames
SERVERS = {
    "workspace": "server.py",
    "abilities": "abilities_server.py",
    "context": "context_server.py",
    "knowledge": "knowledge_server.py"
}

def main():
    if len(sys.argv) < 2:
        print(f"Usage: {sys.argv[0]} <server_name> [additional args...]", file=sys.stderr)
        print(f"Available servers: {', '.join(SERVERS.keys())}", file=sys.stderr)
        sys.exit(1)

    name = sys.argv[1]
    if name not in SERVERS:
        print(f"Unknown server: {name}", file=sys.stderr)
        print(f"Available servers: {', '.join(SERVERS.keys())}", file=sys.stderr)
        sys.exit(1)

    server_file = SERVERS[name]
    mcp_dir = os.path.dirname(os.path.abspath(__file__))
    script_path = os.path.join(mcp_dir, server_file)

    if not os.path.isfile(script_path):
        print(f"Server file not found: {script_path}", file=sys.stderr)
        sys.exit(1)

    # Call the script with --transport stdio and pass through any extra args
    # Note: we skip the first 2 args (stdio.py and <server_name>)
    args = [script_path, "--transport", "stdio"] + sys.argv[2:]

    # Use execv to replace the current process (on Unix)
    if os.name == "posix":
        try:
            # os.execv(executable, args) -> first arg of args should be executable name
            os.execv(sys.executable, [sys.executable] + args)
        except Exception as e:
            print(f"Failed to exec: {e}", file=sys.stderr)
            sys.exit(1)
    else:
        # Fallback for Windows
        process = subprocess.run([sys.executable] + args)
        sys.exit(process.returncode)

if __name__ == "__main__":
    main()

#!/bin/bash
# Deploy executor agent to a remote PC
# Usage: ./scripts/deploy-executor.sh <ssh_alias> <agent_id> <agent_key> <server_url>

set -e

SSH_ALIAS="$1"
AGENT_ID="$2"
AGENT_KEY="$3"
SERVER_URL="$4"

if [ -z "$SSH_ALIAS" ] || [ -z "$AGENT_ID" ] || [ -z "$AGENT_KEY" ] || [ -z "$SERVER_URL" ]; then
  echo "Usage: $0 <ssh_alias> <agent_id> <agent_key> <server_url>"
  echo "Example: $0 pc2 water my-key ws://192.168.50.1:3100/ws"
  exit 1
fi

REMOTE_DIR="boardroom-agent"
echo "=== Deploying executor to $SSH_ALIAS as $AGENT_ID ==="

# Create remote directory
ssh "$SSH_ALIAS" "mkdir -p $REMOTE_DIR" 2>/dev/null

# Create a tarball of what's needed
TMPDIR=$(mktemp -d)
mkdir -p "$TMPDIR/executor/dist" "$TMPDIR/executor/node_modules" "$TMPDIR/shared/dist"

# Copy executor dist
cp -r packages/executor/dist/* "$TMPDIR/executor/dist/"
cp packages/executor/package.json "$TMPDIR/executor/"

# Copy shared dist
cp -r packages/shared/dist/* "$TMPDIR/shared/dist/"
cp packages/shared/package.json "$TMPDIR/shared/"

# Create a simple package.json for the remote
cat > "$TMPDIR/package.json" << PKGJSON
{
  "name": "boardroom-agent",
  "private": true,
  "type": "module",
  "dependencies": {
    "dotenv": "^16.4.7",
    "uuid": "^11.1.0",
    "ws": "^8.18.0",
    "zod": "^3.24.0"
  }
}
PKGJSON

# Create .env
cat > "$TMPDIR/.env" << ENVFILE
AGENT_ID=$AGENT_ID
AGENT_KEY=$AGENT_KEY
SERVER_URL=$SERVER_URL
ENVFILE

# Create start script
cat > "$TMPDIR/start.sh" << 'STARTSH'
#!/bin/bash
cd "$(dirname "$0")"
node executor/dist/index.js
STARTSH
chmod +x "$TMPDIR/start.sh"

# Create a bat file for Windows PCs
cat > "$TMPDIR/start.bat" << 'BATFILE'
@echo off
cd /d "%~dp0"
node executor\dist\index.js
BATFILE

# Tar it up
tar czf /tmp/boardroom-agent.tar.gz -C "$TMPDIR" .

# Copy to remote
scp /tmp/boardroom-agent.tar.gz "$SSH_ALIAS:$REMOTE_DIR/" 2>/dev/null

# Extract and install deps on remote
ssh "$SSH_ALIAS" "cd $REMOTE_DIR && tar xzf boardroom-agent.tar.gz && rm boardroom-agent.tar.gz && npm install --production 2>/dev/null" 2>/dev/null

# Setup node_modules symlink for @boardroom/shared
ssh "$SSH_ALIAS" "cd $REMOTE_DIR && mkdir -p node_modules/@boardroom && ln -sf ../../shared node_modules/@boardroom/shared" 2>/dev/null

echo "=== Deployed to $SSH_ALIAS ==="
echo "Start with: ssh $SSH_ALIAS 'cd $REMOTE_DIR && node executor/dist/index.js'"

# Cleanup
rm -rf "$TMPDIR" /tmp/boardroom-agent.tar.gz

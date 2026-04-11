# Savant — Installation Guide (macOS ARM64)

## Prerequisites

### 1. Install Homebrew (if not already installed)

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

### 2. Install Python 3

```bash
brew install python3
```

### 3. Install Python dependencies

```bash
pip3 install flask==3.1.0 pyyaml==6.0.2 gunicorn==23.0.0 pydantic==2.5.0 "sqlite-vec>=0.1.7" "pathspec>=0.11.0" "pygments>=2.15.0"
```

Or, after mounting the DMG:

```bash
pip3 install -r /Volumes/Savant*/Savant.app/Contents/Resources/savant/requirements.txt
```

## Install

### 4. Mount the DMG

Double-click `Savant-*.dmg`.

### 5. Drag Savant.app to /Applications

### 6. Remove the quarantine flag

Required because the app is not code-signed:

```bash
xattr -cr /Applications/Savant.app
```

## Launch

### 7. Open Savant

Double-click from `/Applications`, or:

```bash
open /Applications/Savant.app
```

On first launch, the semantic search embedding model (~260 MB) will auto-download. This is a one-time download.

## Data Location

| What | Where |
|---|---|
| Database | `~/.savant/savant.db` |
| Logs | `~/Library/Application Support/savant/savant-main.log` |
| Meta | `~/.savant/meta/` |

## Troubleshooting

### "App is damaged and can't be opened"

```bash
xattr -cr /Applications/Savant.app
```

### App opens but shows blank / loading forever

Check that Python has Flask:

```bash
/opt/homebrew/bin/python3 -c "import flask; print(flask.__version__)"
```

If that errors, re-run step 3. Check the log for details:

```bash
tail -50 ~/Library/Application\ Support/savant/savant-main.log
```

### sqlite-vec fails to install

```bash
pip3 install --upgrade pip
pip3 install "sqlite-vec>=0.1.7"
```

If it still fails, install Xcode command line tools:

```bash
xcode-select --install
```

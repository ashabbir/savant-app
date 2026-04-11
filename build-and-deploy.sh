osascript -e 'quit app "Savant"' && sleep 2 && rm -rf dist && npm run build && rsync -a --delete dist/mac-arm64/Savant.app/ /Applications/Savant.app/ && open /Applications/Savant.app


# Convenience launcher: node isn't always on PATH in every shell context,
# this resolves relative to the repo regardless of where it's called from.
param(
  [int]$Port = 4317
)
$env:PORT = $Port
node "$PSScriptRoot\..\server.js"

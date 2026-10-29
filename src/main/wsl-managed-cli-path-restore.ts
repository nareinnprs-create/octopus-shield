/** Leads PATH with the managed WSL CLI after startup files ran; an unusable CLI only warns. */
export const WSL_MANAGED_CLI_PATH_RESTORE = `if [ -n "\${OSHIELD_WSL_CLI_DIR:-}" ]; then
  if [ -x "$OSHIELD_WSL_CLI_DIR/\${OSHIELD_CLI_COMMAND:-}" ]; then
    export PATH="$OSHIELD_WSL_CLI_DIR\${PATH:+:$PATH}"
  else
    printf 'Shield CLI unavailable: cannot run %s. Check WSL Windows-drive mount options.\\n' "$OSHIELD_WSL_CLI_DIR/\${OSHIELD_CLI_COMMAND:-}" >&2
  fi
fi`

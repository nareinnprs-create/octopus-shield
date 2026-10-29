export const OSHIELD_CLI_POSIX_PATH_RESTORE = `if [ -n "\${OSHIELD_CLI_BIN_DIR:-}" ]; then
  case "\${PATH:-}" in
    "$OSHIELD_CLI_BIN_DIR"|"$OSHIELD_CLI_BIN_DIR":*) ;;
    *) export PATH="$OSHIELD_CLI_BIN_DIR\${PATH:+:$PATH}" ;;
  esac
fi`

/** Detect address used as a noun for Shield session identity; exclude verbs and distinct run:/dispatch:/group mailboxes. */
export const OSHIELD_SESSION_ID_AS_ADDRESS =
  /\b(?:orchestration|session|Shield|coordinator's|your(?: own)?) address\b|caller\.address|naming its address/i

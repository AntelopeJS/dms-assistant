export const MAX_AUTO_HEAL_ATTEMPTS = 2;

export const HEAL_PROMPT_INTRO =
  "Your last edits broke the build. The page will 404 until this compiles. Fix these errors, then re-run typecheck with the arguments shown beside each module to confirm it is clean. Without a target, typecheck checks only the host project:";
export const HEAL_PROMPT_TYPECHECK_HEADING = "Type check errors:";
export const HEAL_PROMPT_HOSTLOG_HEADING = "Host reload/build errors:";

export const HEAL_MAX_LOG_LINES = 20;

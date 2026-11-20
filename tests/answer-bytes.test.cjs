const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  OWNER,
  answer,
  reset,
  textOf,
  useRouteHarness,
} = require("./helpers/route-harness.cjs");

const harness = useRouteHarness();

const ONLINE_STATUS = {
  status: "ready",
  provider: "claude",
  builderAvailable: true,
  mode: "normal",
  generationMode: "safe",
  workingConversations: 0,
  pendingApprovals: 0,
  pendingQuestions: 1,
  port: 4123,
  lastError: "Agent exited",
};

void test("answers the status and its banner in the bytes the chat and Settings read", async () => {
  reset();
  answer("GET", "/status", 200, ONLINE_STATUS);
  const status = new harness.routes.AIStatusController();
  assert.deepEqual(
    [textOf(await status.status(OWNER)), textOf(await status.banner(OWNER))],
    [
      '{"status":"ready","provider":"claude","builderAvailable":true,"mode":"normal","generationMode":"safe","workingConversations":0,"pendingApprovals":0,"pendingQuestions":1,"port":4123,"lastError":"Agent exited","isRunning":true,"hasGivenUp":false,"disabled":false}',
      '{"tone":"error","icon":"i-ph-warning-octagon","title":"$dms_assistant.status.banner.last_error.title","description":{"key":"$dms_assistant.status.banner.last_error.description","params":{"error":"Agent exited"}},"actions":[{"label":"$dms_assistant.status.banner.last_error.action","to":"/modules/ai/activity","icon":"i-ph-clock-counter-clockwise"}]}',
    ],
  );
});

void test("answers the ChatGPT account banner in the bytes Settings reads", async () => {
  reset();
  const account = new harness.routes.AICodexAccountController();
  answer("GET", "/codex/account", 200, {
    isSignedIn: false,
    loginUrl: "https://auth.openai.com/api/accounts/authorize?state=s",
  });
  const signedOut = textOf(await account.banner());
  answer("GET", "/codex/account", 200, {
    isSignedIn: true,
    email: "dev@example.com",
  });
  assert.deepEqual(
    [signedOut, textOf(await account.banner())],
    [
      '{"tone":"info","size":"sm","icon":"i-ph-open-ai-logo","title":"$dms_assistant.settings.chatgpt.signed_out.title","description":"$dms_assistant.settings.chatgpt.signed_out.description","actions":[{"label":"$dms_assistant.settings.chatgpt.signed_out.action","icon":"i-ph-sign-in","target":{"type":"external","url":"https://auth.openai.com/api/accounts/authorize?state=s","newTab":true}},{"label":"$dms_assistant.settings.chatgpt.paste.action","icon":"i-ph-clipboard-text","color":"neutral","confirm":{"title":"$dms_assistant.settings.chatgpt.paste.title","description":"$dms_assistant.settings.chatgpt.paste.description","icon":"i-ph-clipboard-text","confirmLabel":"$dms_assistant.settings.chatgpt.paste.confirm","fields":[{"id":"url","label":"$dms_assistant.settings.chatgpt.paste.field","component":{"componentName":"dms-input-text","options":{"placeholder":"http://127.0.0.1:…/auth/chatgpt/callback?code=…"},"children":[]},"type":"string","required":true}]},"target":{"type":"api","url":"/ai/codex/callback","method":"POST","successMessage":"$dms_assistant.settings.chatgpt.paste.success"}}]}',
      '{"tone":"success","size":"sm","icon":"i-ph-open-ai-logo","title":{"key":"$dms_assistant.settings.chatgpt.signed_in.title","params":{"email":"dev@example.com"}},"description":"$dms_assistant.settings.chatgpt.signed_in.description","actions":[{"label":"$dms_assistant.settings.chatgpt.signed_in.action","icon":"i-ph-sign-out","color":"neutral","confirm":{"title":"$dms_assistant.settings.chatgpt.sign_out_confirm.title","description":"$dms_assistant.settings.chatgpt.sign_out_confirm.description","confirmLabel":"$dms_assistant.settings.chatgpt.signed_in.action","color":"error"},"target":{"type":"api","url":"/ai/codex/logout","method":"POST","successMessage":"$dms_assistant.settings.chatgpt.signed_out_toast"}}]}',
    ],
  );
});

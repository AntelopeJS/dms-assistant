/**
 * The screenshots of the dms-ai docs, taken on the Helio demo. The onboarding
 * runs first and creates the owner every other scene is signed in as.
 */
export default [
  {
    id: "onboarding",
    route: "/onboarding?token=helio-capture-setup-token",
    setup: true,
    steps: [
      { action: "fill", selector: 'input[name="name"]', value: "Helio" },
      {
        action: "click",
        selector: 'button:has-text("Continue to administrator")',
      },
      { action: "wait", selector: 'input[name="firstName"]' },
      { action: "fill", selector: 'input[name="firstName"]', value: "Sophie" },
      { action: "fill", selector: 'input[name="lastName"]', value: "Lambert" },
      {
        action: "fill",
        selector: 'input[name="email"]',
        value: "sophie.lambert@helio.be",
      },
      {
        action: "fill",
        selector: 'input[name="password"]',
        value: "HelioDocs2026!",
      },
      {
        action: "click",
        selector: 'button:has-text("Create administrator account")',
      },
      { action: "wait", selector: 'button:has-text("Open the dashboard")' },
      { action: "click", selector: 'button:has-text("Open the dashboard")' },
    ],
  },
  {
    id: "ai-changes",
    route: "/modules/ai/changes",
    output: "docs/images/captures/ai-changes.webp",
  },
  {
    id: "ai-activity",
    route: "/modules/ai/activity",
    output: "docs/images/captures/ai-activity.webp",
  },
  {
    id: "ai-settings",
    route: "/modules/ai/settings",
    output: "docs/images/captures/ai-settings.webp",
  },
  {
    id: "ai-chat-empty",
    route: "/helio/dashboard",
    steps: [
      { action: "wait", selector: ".apexcharts-canvas" },
      { action: "press", key: "Control+Shift+K" },
      { action: "wait", selector: ".cb-empty" },
    ],
    output: "docs/images/captures/ai-chat-empty.webp",
  },
  {
    id: "ai-palette",
    route: "/helio/dashboard",
    steps: [
      { action: "wait", selector: ".apexcharts-canvas" },
      { action: "press", key: "Control+k" },
      { action: "wait", selector: '[role="dialog"] input' },
      { action: "press", key: "Tab" },
    ],
    crop: '[role="dialog"]',
    output: "docs/images/captures/ai-palette.webp",
  },
];

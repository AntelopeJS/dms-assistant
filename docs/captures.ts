import {
  type CaptureStep,
  defineScenes,
} from "@antelopejs/tooling-configs/capture";

const DASHBOARD = "/helio/dashboard";
const POPUP = '[role="dialog"]';

/** The onboarding window opens on every page until the project has content: these steps wait for it, then close it. */
const CLOSE_ONBOARDING: CaptureStep[] = [
  { action: "wait", selector: 'text="Your assistant is ready"' },
  { action: "press", key: "Escape" },
];

/** The onboarding window, on the login `pnpm docs:capture` gives the sidecar, up to the step it waits for. */
function onboardingSteps(...until: CaptureStep[]): CaptureStep[] {
  return [
    { action: "wait", selector: 'text="Your assistant is ready"' },
    ...until,
  ];
}

/**
 * The screenshots of the dms-assistant docs, taken on the Helio demo by `pnpm docs:capture`. The Helio setup
 * runs first and creates the owner every other scene is signed in as.
 */
export default defineScenes([
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
    id: "ai-onboarding-ready",
    route: DASHBOARD,
    steps: onboardingSteps(),
    crop: POPUP,
    output: "docs/images/captures/ai-onboarding-ready.webp",
  },
  {
    id: "ai-onboarding-paths",
    route: DASHBOARD,
    steps: onboardingSteps(
      { action: "click", selector: 'button:has-text("Use this login")' },
      { action: "wait", selector: 'text="Where do you start from?"' },
    ),
    crop: POPUP,
    output: "docs/images/captures/ai-onboarding-paths.webp",
  },
  {
    id: "ai-onboarding-database",
    route: DASHBOARD,
    steps: onboardingSteps(
      { action: "click", selector: 'button:has-text("Use this login")' },
      { action: "click", selector: 'text="Start from an existing database"' },
      { action: "wait", selector: 'text="Connect your database"' },
    ),
    crop: POPUP,
    output: "docs/images/captures/ai-onboarding-database.webp",
  },
  {
    id: "ai-onboarding-scratch",
    route: DASHBOARD,
    steps: onboardingSteps(
      { action: "click", selector: 'button:has-text("Use this login")' },
      { action: "click", selector: 'text="Start from scratch"' },
      { action: "wait", selector: 'text="What are you building?"' },
    ),
    crop: POPUP,
    output: "docs/images/captures/ai-onboarding-scratch.webp",
  },
  {
    id: "ai-mockups",
    route: "/mockups",
    steps: CLOSE_ONBOARDING,
    output: "docs/images/captures/ai-mockups.webp",
  },
  {
    id: "ai-changes",
    route: "/modules/ai/changes",
    steps: CLOSE_ONBOARDING,
    output: "docs/images/captures/ai-changes.webp",
  },
  {
    id: "ai-activity",
    route: "/modules/ai/activity",
    steps: CLOSE_ONBOARDING,
    output: "docs/images/captures/ai-activity.webp",
  },
  {
    id: "ai-settings",
    route: "/modules/ai/settings",
    steps: CLOSE_ONBOARDING,
    output: "docs/images/captures/ai-settings.webp",
  },
  {
    id: "ai-chat-empty",
    route: DASHBOARD,
    steps: [
      ...CLOSE_ONBOARDING,
      { action: "wait", selector: ".apexcharts-canvas" },
      { action: "press", key: "Control+Shift+K" },
      { action: "wait", selector: ".cb-empty" },
    ],
    output: "docs/images/captures/ai-chat-empty.webp",
  },
  {
    id: "ai-palette",
    route: DASHBOARD,
    steps: [
      ...CLOSE_ONBOARDING,
      { action: "wait", selector: ".apexcharts-canvas" },
      { action: "press", key: "Control+k" },
      { action: "wait", selector: '[role="dialog"] input' },
      { action: "press", key: "Tab" },
    ],
    crop: '[role="dialog"]',
    output: "docs/images/captures/ai-palette.webp",
  },
]);

import posthog from "posthog-js";

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;

if (POSTHOG_KEY) {
  posthog.init(POSTHOG_KEY, {
    api_host: "https://us.i.posthog.com",
    person_profiles: "identified_only",
    capture_pageview: true,
    capture_pageleave: true,
    autocapture: true,
  });
}

export default posthog;
export const posthogEnabled = !!POSTHOG_KEY;

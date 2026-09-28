export const marketing = {
  errors: {
    sessionUnavailable: "Session unavailable",
    checkSession: "Unable to verify session."
  },
  hero: {
    eyebrow: "Security+ and CISSP",
    title: "Train for Security+ and CISSP with simulations and smart review.",
    lead:
      "Questions with explanations, timed test mode, review queue (SRS) and metrics per domain to attack your weaknesses.",
    chips: ["No card", "Immediate access", "Desktop and mobile"]
  },
  howItWorks: {
    title: "How it works",
    subtitle: "Short, direct and oriented flow for real evolution.",
    steps: [
      {
        title: "1. Choose the certification and objective",
        description: "Study or Exam, with filters by domain, difficulty and current focus."
      },
      {
        title: "2. Respond and understand why",
        description: "Explanations, confidence level, progressive hints, and official references."
      },
      {
        title: "3. Review what you get wrong",
        description: "Smart queue, domain analysis and weekly progress."
      }
    ]
  },
  whyItWorks: {
    title: "Why this works",
    subtitle: "Training, diagnosis and reinforcement in the same loop.",
    items: [
      ["Timed simulations", "Real time, controlled pause and final review."],
      ["Smart Review (SRS)", "Go back to exactly what you got wrong or got right without security."],
      ["Analysis by domain", "Quickly see where your gaps are."],
      ["Full explanations", "It's not just the right letter: the system guides the reasoning."],
      ["Notes and favorites", "Build your personal study path."],
      ["Optional AI Tutor", "Use it when you need to clear a specific doubt."]
    ]
  },
  preview: {
    title: "Product preview",
    subtitle: "Everything you need, no distractions.",
    cards: [
      {
        title: "Dashboard",
        subtitle: "Weak domains, weekly target and quick recovery.",
        chips: ["weak areas", "rhythm", "retention"]
      },
      {
        title: "Simulation Runner",
        subtitle: "Timer, navigation and total focus on execution.",
        chips: ["real time", "pause", "result"]
      },
      {
        title: "Review",
        subtitle: "Queue, explanation and study context.",
        chips: ["SRS", "hints", "references"]
      }
    ]
  },
  offer: {
    title: "Offer",
    subtitle: "Beta access: free for a limited time.",
    items: [
      ["Free beta", "Study mode, exam mode, basic review and main analyses."],
      ["Planned evolution", "Complete analytics, deeper adaptive simulations, and premium features."]
    ]
  },
  faq: {
    title: "FAQ",
    subtitle: "Objective, independent and transparent.",
    items: [
      ["Is this a dump?", "No. The focus is training with explanations, hints, and review so you understand the content."],
      ["Are you affiliated with CompTIA or ISC2?", "No. It is an independent platform."],
      ["Are the questions updated?", "Yes. The catalog is continually versioned and revised."],
      ["Can I study on my cell phone?", "Yes. The flow was designed for desktop and mobile."],
      ["How do goals and review work?", "The system records your performance, sets up a reinforcement queue and suggests the next action."]
    ]
  },
  trust: {
    title: "Trust and transparency",
    subtitle: "No exaggeration of promises and no dependence on memorization.",
    chips: ["Protected data", "Secure session", "No spam", "Independent platform"]
  },
  cta: {
    eyebrow: "Ready to start",
    title: "Start today and see your progress in 7 days."
  }
} as const;

/**
 * Translations of backend message codes (`code` + `params`, M-C7). Keys mirror the codes
 * sent by the API ("study_plan.risk_domain" -> backend.study_plan.risk_domain). Unknown
 * codes fall back to the backend text (see lib/i18n/backend-messages.ts).
 */
export const backend = {
  study_plan: {
    placement: {
      title: "Take the placement check",
      description: "Build a short per-domain baseline before moving on to heavier practice exams.",
      cta: "Start placement"
    },
    review_backlog: {
      title: "Clear overdue reviews",
      description: "{count} review(s) are overdue right now.",
      cta: "Open review"
    },
    risk_domain: {
      title: "Tackle exam risk in {domain}",
      description: "Your weakest domain deserves a short focused block before the next mixed exam.",
      cta: "Open focused block"
    },
    momentum: {
      title: "Keep the pace with a short block",
      description: "No critical backlog right now. Keep variety and consistency.",
      cta: "Start sprint"
    },
    notes: {
      title: "Review your notebook",
      description: "Use your recent notes to reinforce the points with the most friction.",
      cta: "Open settings"
    },
    targeted_review: {
      title: "Focused review on {domain}",
      description: "Turn the readiness signal into a domain-driven review.",
      cta: "Filter review"
    },
    quick_exam: {
      title: "Check retention with a short exam",
      description: "Use a quick block to confirm the reinforcement stuck.",
      cta: "Open exam"
    }
  },
  readiness: {
    insufficient_data:
      "Not enough recent history yet ({attempts} of {required} answers). Answer more questions to unlock the estimate.",
    overdue_reviews: "{count} overdue review(s) lower your projection.",
    session_weakest_domain: "{domain} is still the main friction point in this session.",
    weakest_domain: "{domain} is your lowest-scoring domain ({score}%).",
    slow_domain: "Pace: {domain} is slow ({seconds}s per question on average).",
    low_coverage: "The estimate covers only {coverage}% of the blueprint; practice the missing domains.",
    stale_activity: "Your recency dropped; review again within the next 24 hours.",
    consistent: "Solid base. Focus on reducing residual errors and keeping the pace."
  },
  readinessBands: {
    strong: "Strong",
    stable: "Stable",
    developing: "Developing",
    at_risk: "At risk",
    insufficient_data: "Not enough data"
  }
} as const;

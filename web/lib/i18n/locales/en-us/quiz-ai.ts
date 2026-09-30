export const quizAi = {
  badge: {
    label: "AI-generated",
    short: "AI"
  },
  entry: {
    generate: "Generate with AI",
    running: "AI generating"
  },
  empty: {
    title: "Start your quiz in seconds",
    message: "Describe a topic or paste a text: AI writes draft questions, you choose what goes in and review it before publishing.",
    messageNoAi: "Write your own questions or draw reviewed questions from the Bank with the coverage you want.",
    steps: {
      describe: "Describe the topic, pick a certification or paste a text",
      review: "Review the drafts with the automatic reviewer's warnings",
      present: "Publish and present to the room"
    },
    add: "Write a question",
    bank: "Bring from the Bank"
  },
  dialog: {
    title: "Generate with AI",
    description: "AI writes drafts; nothing enters the quiz without your choice, and every question goes through your review before publishing.",
    tabsLabel: "How to generate the questions",
    tabs: {
      topic: "From a topic",
      source: "From a text",
      bank: "Draw from the bank"
    },
    noAi: "no AI"
  },
  unavailable: {
    ai_disabled: {
      title: "AI authoring is turned off",
      message: "The feature has not been enabled in this environment yet (AI_AUTHORING_ENABLED)."
    },
    not_allowed: {
      title: "Your account cannot use AI authoring",
      message: "Ask the platform administrator for access."
    },
    quota_exhausted: {
      title: "You are out of AI credits for today",
      message: "The daily quota resets at midnight (UTC)."
    },
    unavailable: {
      title: "AI authoring is unavailable right now",
      message: "Try again in a few minutes."
    },
    bankStillWorks: "Drawing from the bank still works, because it does not use AI."
  },
  credits: {
    remaining: "{remaining} of {limit} credits today",
    unlimited: "Unlimited AI credits",
    cost: "Cost: {cost} credits",
    after: "{after} left afterwards",
    insufficient: "You have {remaining} credits today. Reduce to {max} questions or fewer.",
    meterLabel: "AI credits used today"
  },
  form: {
    optional: "(optional)",
    counter: "{count} / {max}",
    tooLong: "{count} characters over the limit.",
    tooShort: "{count} more characters to reach the minimum of {min}.",
    errorsTitle: "Check before generating:",
    errors: {
      topicOrCertification: "Enter a topic or choose a certification.",
      topicTooLong: "The topic is over the character limit.",
      audienceTooLong: "The audience note is over 200 characters.",
      domainsMax: "Choose at most 10 domains.",
      sourceTooShort: "Paste at least 200 characters of text.",
      sourceTooLong: "The text is over the character limit.",
      titleTooLong: "The text subject is over 120 characters.",
      types: "Choose at least one question type.",
      count: "Choose a valid number of questions."
    },
    full: "The quiz is already at its question limit.",
    submit: "Generate {count} questions",
    submitOne: "Generate 1 question",
    topic: {
      label: "Topic or objective",
      hint: "Describe what the room should learn. Be specific: concepts, scenario, exam objective.",
      placeholder: "E.g. cloud access controls (Security+ objective 3.2), focusing on IAM and least privilege"
    },
    certification: {
      label: "Certification",
      none: "None (topic only)",
      hint: "Uses the official blueprint: domains, terminology and the current exam version."
    },
    domains: {
      label: "Domains",
      hint: "With no selection, AI spreads the questions across the blueprint.",
      selected: "{count} of {max}",
      max: "Limit of {max} domains reached.",
      pickCertification: "Choose a certification to see its domains."
    },
    audience: {
      label: "Audience note",
      hint: "Helps calibrate vocabulary and scenarios.",
      placeholder: "E.g. junior SOC analysts in onboarding"
    },
    count: {
      label: "Number of questions",
      hint: "From 1 to {max}. {capacity} more questions fit in this quiz.",
      slider: "Number of questions (slider)"
    },
    level: {
      label: "Level",
      mixed: "Mixed",
      Easy: "Easy",
      Medium: "Medium",
      Hard: "Hard"
    },
    types: {
      label: "Question types",
      hint: "Choose at least one."
    },
    language: {
      label: "Question language",
      ptBR: "Portuguese (Brazil)",
      en: "English"
    },
    source: {
      label: "Source text",
      hint: "Paste {min} to {max} characters: a chapter, an internal policy, lecture notes.",
      placeholder: "Paste the content the room studied here…",
      privacy: "Before sending to AI we remove e-mails, CPF numbers and phone numbers. The text is treated as content, never as instructions."
    },
    titleHint: {
      label: "Text subject",
      hint: "Helps AI understand the context (e.g. \"Password policy 2026\")."
    }
  },
  bank: {
    intro: "Deterministic draw, no AI and no credits: picks reviewed questions from the Bank with the coverage you ask for.",
    anyCertification: "Any certification",
    difficulty: "Difficulty",
    anyDifficulty: "Any difficulty",
    domainsHint: "With no selection, the draw uses every domain of the certification.",
    count: "Number of questions",
    strategy: {
      label: "Strategy",
      coverage: {
        name: "Coverage",
        description: "Spreads questions across domains, like the exam."
      },
      random: {
        name: "Random",
        description: "Draws without balancing by domain."
      }
    },
    onlyGuest: "Only questions cleared for guests",
    onlyGuestHint: "Recommended: rooms accept guests without login by default, and restricted questions block the room.",
    submit: "Draw {count} questions",
    redraw: "Draw again",
    add: "Add {count} to the quiz",
    result: {
      title: "{count} questions drawn",
      noneTitle: "No questions found",
      available: "{available} available with these filters",
      coverage: "Coverage by domain",
      domainCount: "{count} questions",
      none: "Try another difficulty, fewer domains or clear the guest restriction.",
      rejected: "{count} questions could not be added"
    }
  },
  recent: {
    title: "Recent generations",
    count: "{count} generations in this quiz",
    empty: "No generations for this quiz yet.",
    loadError: "Could not load recent generations.",
    credits: "{credits} credits",
    open: "Open generation"
  },
  kind: {
    generate: "Topic generation",
    from_source: "Generation from text",
    improve: "Question improvement"
  },
  status: {
    queued: "Queued",
    running: "Generating",
    succeeded: "Ready",
    failed: "Failed",
    degraded: "Bank mode"
  },
  job: {
    back: "New generation",
    stepsLabel: "Generation steps",
    steps: {
      generating: { name: "Generating", hint: "AI writes the drafts" },
      validating: { name: "Validating", hint: "Quality rules and duplicates" },
      critic: { name: "Critic review", hint: "A reviewer answers without seeing the key" },
      done: { name: "Ready", hint: "You choose what goes in" }
    },
    stepState: {
      done: "done",
      current: "in progress",
      pending: "pending"
    },
    announce: "Current step: {step}",
    progressLabel: "Generation progress",
    elapsedLabel: "Elapsed time:",
    running: {
      queued: "Queued: generation starts in a moment…",
      running: "AI is writing your questions…"
    },
    writing: "Drafts being written",
    background: "You can close this window: generation continues and stays under Recent generations.",
    slow: "This is taking longer than usual. You can close the window and come back later; generation continues.",
    failed: {
      title: "Generation failed",
      message: "AI could not complete the request.",
      refunded: "The reserved credits were refunded.",
      retry: "Try again"
    },
    finished: {
      queued: "Queued.",
      running: "Generating.",
      succeeded: "Generation complete. The drafts are ready for review.",
      failed: "Generation failed.",
      degraded: "AI is unavailable; there are suggestions from the bank."
    },
    loadError: "Could not follow the generation.",
    noResult: "This generation has no result to show."
  },
  injection: {
    title: "Instructions in the text were ignored",
    message: "The text seems to contain commands for the AI (such as \"ignore previous instructions\"). They were treated as content, not as orders. Review the drafts with extra care."
  },
  degraded: {
    title: "AI is unavailable right now",
    message: "We suggest these {count} reviewed questions from the bank instead.",
    none: "We could not find bank questions to suggest either. Try again in a few minutes.",
    add: "Add {count} from the bank",
    added: "{count} bank questions added to the quiz.",
    partial: "{added} questions added; {rejected} could not be added."
  },
  review: {
    summary: "{produced} of {requested} drafts · {blocked} with errors · {warnings} with warnings",
    listLabel: "Generated drafts",
    selectAllValid: "Select all valid",
    clear: "Clear selection",
    selected: "{count} selected",
    capacity: "{count} more fit in the quiz",
    full: "the quiz is full",
    add: "Add {count} to the quiz",
    addOne: "Add 1 to the quiz",
    addNone: "Select drafts",
    appliedTitle: "{count} questions added to the quiz",
    appliedMessage: "They come in marked \"Review\": approve each one in the editor before publishing.",
    goToEditor: "Open in the editor",
    emptyTitle: "No usable drafts",
    empty: "AI produced no drafts this time. Rephrase the topic or choose another certification.",
    itemTitle: "AI-generated question: review before publishing",
    itemMessage: "Check the prompt, the options and the answer key. Publishing stays blocked until you approve it."
  },
  draft: {
    label: "Draft {number}",
    optionsLabel: "Options",
    correct: "Correct",
    whyWrong: "Why {key} is wrong",
    explanation: "Explanation",
    acceptedAnswers: "Accepted answers",
    seconds: "{seconds} s",
    difficulty: {
      Easy: "Easy",
      Medium: "Medium",
      Hard: "Hard"
    },
    state: {
      applied: "Already added",
      blocked: "Blocked by an error",
      forced: "Will be added despite the error",
      selected: "Selected",
      notSelected: "Not selected"
    },
    blockedHint: "This draft has an error and is left out, unless you decide to add it and fix it in the editor.",
    forcedHint: "You chose to add it despite the error. Fix it in the editor before publishing.",
    forceAdd: "Add anyway",
    undoForce: "Don't add"
  },
  severity: {
    error: "Error",
    warning: "Warning"
  },
  issues: {
    schema_invalid: "Invalid format",
    single_needs_one: "Needs exactly one correct option",
    multi_needs_two: "Multiple response needs 2+ correct and 1+ wrong",
    duplicate_option: "Repeated options",
    all_none_of_above: "\"All/none of the above\"",
    negative_stem: "Negative stem without emphasis",
    length_bias: "Correct option longer than the others",
    duplicate_bank: "Similar to a bank question",
    duplicate_batch: "Repeated in this batch",
    unknown_domain: "Domain outside the blueprint",
    language_mismatch: "Language differs from the request",
    obsolete_exam: "Mentions an obsolete exam version",
    key_mismatch: "Answer key disputed by the reviewer",
    ambiguous: "Ambiguous question"
  },
  critic: {
    title: "Automatic reviewer",
    confidence: "Confidence {pct}%",
    confidenceLabel: "Automatic reviewer confidence",
    agrees: "Without seeing the key, the reviewer reached the same answer ({keys}).",
    noKeys: "no option",
    none: "No automatic review for this draft.",
    needsConfirm: "When approving in the editor, you will confirm this question's answer key.",
    flags: {
      key_mismatch: {
        title: "Answer key disputed",
        message: "The automatic reviewer, without seeing the key, chose {keys} (the key says {expected})."
      },
      ambiguous: {
        title: "Possible ambiguity",
        message: "More than one answer can be defended, or the reviewer's confidence was below 70%."
      },
      factual_issue: {
        title: "Possible factual error",
        message: "The reviewer flagged a fact that may be wrong or outdated. Check the source."
      }
    }
  },
  improve: {
    title: "Improve with AI",
    description: "Get a proposal and compare before applying.",
    actionsLabel: "What to improve",
    actions: {
      rewrite: {
        name: "Rewrite for clarity",
        description: "A more direct prompt and options without giveaways, keeping the key."
      },
      distractors: {
        name: "Generate new distractors",
        description: "Replaces the wrong options with plausible misconceptions."
      },
      explain: {
        name: "Write an explanation",
        description: "Explains why the correct option is right and the others are not."
      }
    },
    instructions: {
      label: "Instructions",
      placeholder: "E.g. use a banking scenario; spell out acronyms"
    },
    submit: {
      rewrite: "Rewrite",
      distractors: "Generate distractors",
      explain: "Write explanation"
    },
    running: "Preparing the proposal…",
    ready: "Proposal ready",
    proposal: "AI proposal",
    before: "Before",
    after: "After",
    fields: {
      prompt: "Prompt",
      options: "Options",
      explanation: "Explanation"
    },
    empty: "(empty)",
    noChanges: "AI suggested no changes for this question.",
    reviewNote: "Applying puts the question back into \"Review\".",
    apply: "Apply",
    discard: "Discard",
    again: "Try again",
    applied: "Proposal applied. The question is back in \"Review\".",
    failed: "The improvement failed",
    unavailableNow: "AI is unavailable right now. Try again in a few minutes.",
    noCredits: "Not enough credits for this improvement today.",
    needsPrompt: "Write the prompt before asking for an improvement."
  },
  provenance: {
    model: "Model: {model}",
    noMeta: "Created by AI authoring",
    show: "Details",
    hide: "Hide",
    message: "This question came from an AI generation. The points below were found by validation and by the automatic reviewer."
  },
  keyConfirm: {
    label: "I checked this question's answer key",
    mismatch: "The automatic reviewer, without seeing the key, chose {keys}; the current key is {expected}.",
    ambiguous: "The reviewer found that more than one answer can be defended.",
    generic: "The automatic reviewer had doubts about this question.",
    required: "Tick \"I checked this question's answer key\" to approve this question."
  },
  suggestTime: {
    button: "Suggest time",
    result: "Suggestion: {seconds} s",
    apply: "Use {seconds} s",
    same: "Already set to this time",
    dismiss: "Dismiss"
  },
  errors: {
    quota: "Your AI credits for today do not cover this request ({remaining} left). The quota resets at midnight (UTC).",
    quotaUnknown: "Your AI credits for today do not cover this request. The quota resets at midnight (UTC).",
    tooManyJobs: "You already have generations running. Wait for one to finish before starting another.",
    disabled: "AI authoring is turned off in this environment.",
    draftBlocked: "One of the drafts has an error. Use \"Add anyway\" to include it.",
    alreadyApplied: "These drafts were already added to the quiz.",
    notReady: "The generation has not finished yet.",
    conflict: "The quiz was changed in another tab. We loaded the newest version; try again.",
    generic: "Could not complete the AI action."
  }
} as const;

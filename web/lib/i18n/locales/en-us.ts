export const enUSMessages = {
  metadata: {
    title: "Sentinel Quiz | Security+ and CISSP",
    description:
      "Train for Security+ and CISSP with simulations, guided study, smart review and metrics by domain."
  },
  common: {
    appName: "Sentinel Quiz",
    labels: {
      dashboard: "Dashboard",
      start: "Start",
      review: "Review",
      history: "History",
      settings: "Settings",
      admin: "Admin",
      exam: "Exam",
      study: "Study"
    },
    actions: {
      signIn: "Sign in",
      signOut: "Sign out",
      createAccount: "Create account",
      refresh: "Refresh",
      continue: "Continue",
      retry: "Try again",
      openHistory: "Open history",
      reviewNow: "Review now",
      newSession: "New session",
      seeDetails: "View details",
      resume: "Resume",
      pause: "Pause",
      goToDashboard: "Go to dashboard",
      backToDashboard: "Back to dashboard",
      openResult: "Open result",
      resendVerification: "Resend verification",
      startFree: "Start free",
      seeDemo: "View demo",
      alreadyHaveAccount: "I already have an account",
      goToStart: "Start new session",
      nextQuestion: "Next question",
      viewResult: "See result"
    },
    status: {
      marked: "marked",
      withNote: "with note",
      loading: "Loading...",
      syncingSession: "Syncing session...",
      updating: "Updating",
      upToDate: "Up to date",
      closed: "Closed"
    },
    filters: {
      all: "All",
      everything: "Everything",
      allDomains: "All domains",
      mixedRandom: "Mix them all (random)",
      selectExam: "Select an exam"
    },
    reviewStates: {
      dueToday: "Due today",
      overdue: "Late",
      atRisk: "At risk",
      scheduled: "Scheduled",
      mastered: "Mastered"
    },
    strategies: {
      standard: "Standard",
      adaptive: "Adaptive"
    },
    confidence: {
      guess: "I guessed",
      notSure: "I'm not sure",
      confident: "I'm sure"
    },
    errors: {
      unexpected: "An unexpected error has occurred.",
      attention: "Attention",
      partialLoad: "Partial load",
      sessionUnavailable: "Session unavailable",
      authFailure: "Authentication failure",
      requiredFields: "Required fields",
      invalidPassword: "Invalid password",
      missingToken: "Missing Token"
    }
  },
  navigation: {
    ariaLabel: "Main navigation",
    brandTitle: "Sentinel Quiz",
    brandSubtitle: "Practice exams, guided study, and smart review for Security+ and CISSP.",
    locale: {
      label: "Language",
      ptBR: "PT-BR",
      enUS: "EN",
      switchToPtBR: "Switch to Portuguese",
      switchToEnUS: "Switch to English"
    },
    publicLinks: {
      howItWorks: "How it works",
      faq: "FAQ"
    },
    errors: {
      sessionRefresh: "Unable to update session."
    }
  },
  dashboard: {
    defaults: {
      recommendedNextAction: "Start a short session to get back into the swing of things."
    },
    loadError: "Not everything loaded: {items}.",
    failedAreas: {
      weakAreas: "gaps",
      pace: "rhythm",
      review: "review",
      history: "history",
      examSessions: "simulation sessions",
      studySessions: "study sessions"
    },
    modes: {
      examMixed: "Mixed simulation",
      studyMixed: "Mixed study"
    },
    header: {
      title: "Today",
      subtitle: "Your focus today: review what won and maintain consistency."
    },
    todayCard: {
      title: "Today",
      subtitle: "One main action: cleaning up what has expired.",
      dueReviews: "Expired reviews",
      dailyProgress: "Daily progress",
      latestScore: "Last score",
      nextStep: "Next step"
    },
    continueCard: {
      title: "Continue",
      subtitle: "Return only to what still makes sense.",
      empty: "No active sessions. Open a new block whenever you want."
    },
    weakAreasCard: {
      title: "Weaknesses",
      subtitle: "Only the most useful signals to decide the next block.",
      empty: "Not enough history to highlight gaps yet."
    },
    summaryCard: {
      title: "Quick Summary",
      subtitle: "Minimum context so as not to miss a beat.",
      currentStreak: "Current streak",
      bestStreak: "Best streak",
      week: "Week",
      reviewGoal: "Review goal",
      nextReview: "Next review",
      update: "Update"
    },
    planCard: {
      title: "My plan",
      subtitle: "The next best action is always visible.",
      placementPending: "Pending diagnosis"
    },
    weekCard: {
      title: "This week",
      subtitle: "Progress and revision pressure in a short summary.",
      reviewBacklog: "Backlog",
      weeklyProgress: "Weekly goal",
      reviewGoal: "Review goal"
    }
  },
  launcher: {
    card: {
      title: "Start",
      subtitle: "Choose the essentials and get started in just a few seconds."
    },
    fields: {
      certification: "Certification",
      mode: "Mode",
      questions: "Questions",
      timeMinutes: "Time (min)",
      advancedFilters: "Advanced filters",
      domain: "Domain",
      strategy: "Strategy",
      difficulty: "Difficulty",
      tags: "Tags"
    },
    advanced: {
      active: "assets",
      optional: "optional"
    },
    presets: {
      title: "Presets",
      summaryTitle: "Preset summary",
      items: {
        placement: {
          title: "Initial diagnosis",
          summary: "20 adaptive questions to create your baseline per domain."
        },
        daily_review: {
          title: "Recommended daily review",
          summary: "10 questions to reinforce memory and confidence."
        },
        quick_15: {
          title: "Quick simulation 15 min",
          summary: "15 questions in 15 minutes to measure retention."
        },
        comptia_exam: {
          title: "CompTIA test mode",
          summary: "45 questions focusing on blueprint and exam pressure."
        },
        sprint_25: {
          title: "Sprint 25 min",
          summary: "20 adaptive questions to keep pace without overload."
        },
        risk_focus: {
          title: "Evidence risk",
          summary: "Short, focused block to attack the most sensitive domain now."
        },
        custom: {
          title: "Custom",
          summary: "Manually adjust the filters and assemble a custom block."
        }
      }
    },
    filters: {
      bookmarked: "Marked",
      notes: "With note",
      incorrect: "Wrong",
      unseen: "News",
      lowConfidence: "Low confidence"
    },
    actions: {
      createStudyBlock: "Create study block",
      createExam: "Create simulation"
    }
  },
  start: {
    errors: {
      searchUnavailable: "Question search unavailable: {message}",
      unexpected: "An unexpected error has occurred.",
      createSessionTitle: "Unable to create session",
      invalidQuantityTitle: "Invalid quantity",
      invalidQuantityMessage: "Enter at least 1 question.",
      quantityLimitTitle: "Quantity above limit",
      quantityLimitMessage: "The current limit for {mode} is {count} questions.",
      invalidTimeTitle: "Invalid time",
      invalidTimeMessage: "Use between 5 and 360 minutes."
    },
    notices: {
      loadingDomainsTitle: "Updating domains",
      loadingDomainsMessage: "Loading certification filters."
    },
    header: {
      title: "Start",
      subtitle: "Build a short block, start quickly and leave the rest on demand."
    },
    discovery: {
      summary: "Explore question bank",
      foundCount: "{count} found(s)",
      title: "Discover issues",
      subtitle: "Only look in the bank when you need to refine the cut.",
      query: "Text",
      domain: "Domain",
      tag: "Tag",
      queryPlaceholder: "Ex.: cryptography, asset, incident",
      tagPlaceholder: "Example: access control",
      bookmarkedOnly: "Just marked",
      notesOnly: "Only with note",
      resultsAriaLabel: "Question search results",
      loading: "Updating results...",
      empty: "No issues found with current filters."
    }
  },
  review: {
    errors: {
      loadQueue: "Unable to load review queue."
    },
    header: {
      title: "Review",
      subtitle: "Prioritize what’s due now and keep the queue under control."
    },
    todayCard: {
      title: "Today's queue",
      subtitle: "A single main action: review what is already due.",
      due: "Overdue",
      total: "Total in queue",
      suggestedBatch: "Suggested lot"
    },
    filters: {
      title: "Refine queue",
      subtitle: "Adjust the cropping without turning the review into a cumbersome panel.",
      certification: "Certification",
      state: "Crop",
      refine: "Refining",
      bookmarksOnly: "Only marked",
      notesOnly: "Only with note"
    },
    priorityCard: {
      title: "Prioritized items",
      subtitle: "The most sensitive items are at the top."
    },
    empty: "No pending review items at this time.",
    queueState: {
      overdue: "late {days} day(s) ago",
      dueToday: "due today",
      atRisk: "expires within 48 hours",
      mastered: "already consolidated",
      scheduledFor: "scheduled for {date}",
      scheduled: "scheduled"
    }
  },
  settings: {
    header: {
      title: "Settings",
      subtitle: "Account, sync and your personal notebook in a separate place."
    },
    notices: {
      loggedOutTitle: "Session closed",
      loggedOutMessage: "You are back in local mode for this device.",
      logoutFailureTitle: "Failed to exit"
    }
  },
  account: {
    card: {
      title: "Account and sync",
      subtitle: "Sync progress across devices without losing local fallback."
    },
    summary: {
      ariaLabel: "Account Summary",
      bookmarks: "Bookmarks",
      notes: "Notes",
      dueReviews: "Expired reviews"
    },
    lists: {
      updatedAt: "Updated in {date}",
      recentBookmarks: "Recent Bookmarks",
      recentNotes: "Recent notes",
      reviewQueue: "Review queue",
      noBookmarks: "No bookmarks saved yet.",
      noNotes: "No notes saved yet.",
      noDueReviews: "No reviews due at this time."
    },
    guest: {
      localModeTitle: "Active local mode",
      localModeMessage:
        "You can still use your current device, but your progress is not synced across browsers.",
      signInTitle: "Authenticate to consolidate history",
      signInMessage:
        "When you sign in, the backend associates sessions, bookmarks, notes, and reviews from this device with your account."
    },
    user: {
      roleLabel: "paper",
      sinceLabel: "since"
    }
  },
  insights: {
    empty: {
      exams: "No simulations completed yet. Create a first block to populate this panel.",
      study: "No study blocks completed yet.",
      weakAreas: "Not enough history to detect gaps yet."
    },
    titles: {
      weakAreas: "Gaps and dependence by area",
      weakAreasSubtitle: "This block translates current history into study priority for certification.",
      queueAndActivity: "Review and activity queue",
      queueAndActivitySubtitle: "Quick visibility of what is pending and what has already been studied.",
      latestExams: "Latest simulations",
      latestStudy: "Last study blocks"
    },
    labels: {
      recentErrors: "{ratio}% recent errors",
      focus: "Focus",
      dueReviews: "Expired reviews",
      recentExams: "Recent simulations",
      studyBlocks: "Study blocks",
      mixedExam: "Mixed simulation",
      mixedStudy: "Mixed block",
      correctAnswers: "correct",
      strategy: "strategy",
      reviewedOn: "reviewed in {date}"
    }
  },
  history: {
    errors: {
      loadHistory: "Unable to load history now.",
      partialLoad: "Some blocks failed to load: {items}."
    },
    failedAreas: {
      exams: "evidence",
      examSessions: "simulated",
      study: "study",
      weekly: "weekly analysis",
      reviewQueue: "review queue"
    },
    header: {
      title: "History and analysis",
      subtitle: "Sessions, review and weekly rhythm separated by context."
    },
    filters: {
      title: "Filters",
      subtitle: "Refine reading without turning everything into a megapanel.",
      exam: "Exam",
      minimumScore: "Minimum grade",
      search: "Search"
    },
    tabs: {
      sessions: "Sessions",
      review: "Review",
      weeks: "Weeks"
    },
    sessions: {
      title: "Summary",
      subtitle: "Quick reading of recent volume.",
      filteredExams: "Filtered simulations",
      examAverage: "Average of simulations",
      studyAverage: "Study average",
      dueQueue: "Queue expired",
      totalQueue: "Total queue",
      nextReview: "Next review",
      examsTitle: "Simulations",
      examsSubtitle: "Each item opens the corresponding session review.",
      studiesTitle: "Study",
      studiesSubtitle: "Study blocks and more sensitive areas."
    },
    reviewPanel: {
      weeklyGoalTitle: "Weekly goal",
      weeklyGoalSubtitle: "A practical target for balancing new study and revision.",
      questionGoal: "Question target",
      reviewGoal: "Reviews target",
      newSuggested: "New suggested",
      completion: "Conclusion",
      forecastTitle: "Expected load",
      forecastSubtitle: "Anticipate peaks before becoming a backlog.",
      dueInSevenDays: "Expires in 7 days",
      enteringRisk: "They are at risk",
      peakDay: "Daily peak",
      pressure: "Pressure",
      queueTitle: "Review queue",
      queueSubtitle: "Items with the highest back pressure appear first."
    },
    weeksPanel: {
      title: "Weekly rhythm",
      subtitle: "Volume, reviews and quality per week."
    }
  },
  auth: {
    errors: {
      authUnavailable: "Unable to complete authentication."
    },
    notices: {
      sessionUnavailable: "Session unavailable",
      sessionStarted: "Logged in",
      accountCreated: "Account created",
      localMerged: "This device's local progress has been linked to your account where applicable.",
      loggedOut: "Session closed",
      localMode: "You are back in local mode for this device.",
      verificationResent: "Verification resent",
      verificationResentMessage: "If the email exists and is active, you will receive a new verification link.",
      resendFailed: "Failed to resend",
      logoutFailed: "Failed to exit"
    },
    hero: {
      loginEyebrow: "Secure session",
      registerEyebrow: "Account creation",
      loginTitle: "Sign in to sync your progress.",
      registerTitle: "Create your account and continue from any device.",
      lead:
        "Authentication uses HttpOnly cookie on the backend. When you sign in, the system associates local history, bookmarks, notes, and pending reviews with your account without exposing the session in localStorage.",
      benefitsAriaLabel: "Account benefits"
    },
    stats: [
      {
        label: "Synchronization",
        value: "Account",
        meta: "Unified history, review and progress."
      },
      {
        label: "Security",
        value: "HttpOnly",
        meta: "Session protected via cookie and typed backend."
      },
      {
        label: "Continuity",
        value: "Auto-merge",
        meta: "The current device is committed when applicable."
      },
      {
        label: "Access",
        value: "Web",
        meta: "Ready for study, simulations and guided review."
      }
    ],
    form: {
      loginTitle: "Sign in",
      registerTitle: "Create account",
      loginSubtitle: "Use the same account to resume studies and simulations in any browser.",
      registerSubtitle: "Create an account to save your progress and unlock protected flows.",
      requiredMessage: "Fill in your email and password before continuing.",
      invalidPasswordMessage: "Use at least 8 characters to create the account.",
      name: "Name",
      nameHint: "Optional. Makes it easier to identify the account.",
      email: "Email",
      password: "Password",
      loginPasswordHint: "Use your existing account password.",
      registerPasswordHint: "Minimum 8 characters.",
      goToRegister: "Go to registration",
      forgotPassword: "Forgot password"
    },
    account: {
      roleLabel: "paper",
      emailVerified: "Verified email",
      emailPending: "Pending Email"
    },
    flow: {
      title: "What happens when authenticating",
      subtitle: "Flow designed to preserve data and avoid rework.",
      steps: [
        {
          title: "1. Secured session on the backend",
          description:
            "Login establishes the main session via HttpOnly cookie and keeps the token in memory for transient support only."
        },
        {
          title: "2. Local progress merge",
          description:
            "Sessions, bookmarks, notes, and review queue items from your current device can be associated with your account automatically."
        },
        {
          title: "3. Continuity between devices",
          description:
            "After logging in, the dashboard, history and study modes now reflect the scope of the account."
        }
      ]
    }
  },
  marketing: {
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
  },
  password: {
    forgot: {
      title: "Recover password",
      subtitle: "Request a secure link to reset your password.",
      emailRequiredTitle: "Mandatory email",
      emailRequiredMessage: "Enter your account email to continue.",
      requestedTitle: "Request registered",
      requestedMessage: "If the account exists, an email with the reset link has been sent.",
      failedTitle: "Failed to request",
      failedMessage: "Unable to start recovery.",
      emailLabel: "Email",
      submit: "Send link",
      backToLogin: "Back to login"
    },
    reset: {
      title: "Set new password",
      subtitle: "Use the link received by email to complete the reset.",
      missingTokenMessage: "The reset link is incomplete.",
      invalidPasswordMessage: "Use at least 8 characters.",
      updatedTitle: "Updated password",
      updatedMessage: "Your password has been reset. Log in again with the new credential.",
      failedTitle: "Failed to reset",
      failedMessage: "Unable to reset password.",
      passwordLabel: "New password",
      passwordHint: "Minimum 8 characters.",
      submit: "Update password"
    },
    verify: {
      title: "Email verification",
      subtitle: "Identity confirmation to strengthen the account.",
      missingTokenMessage: "The verification link is incomplete.",
      successTitle: "Verified email",
      successMessage: "Email {email} was successfully validated.",
      failedTitle: "Verification failed",
      failedMessage: "Unable to validate email.",
      goToLogin: "Go to login"
    }
  },
  admin: {
    header: {
      title: "Sentinel Quiz Admin",
      subtitle:
        "Editorial panel migrated to Next.js with real CRUD, payload preview and secure session access."
    },
    notices: {
      editorialAccess: "Editorial access",
      status: "Status"
    },
    access: {
      title: "Access and maintenance",
      subtitle: "All editorial operations require an authenticated session with an admin role.",
      refresh: "Refresh",
      reimportJson: "Reimport JSONs",
      exportDatabase: "Export bank",
      accessControlTitle: "Access control",
      accessControlMessage:
        "The backend only accepts authenticated admin users. The panel no longer uses static keys or editorial headers.",
      quickSummaryTitle: "Quick Summary",
      summaryAriaLabel: "Editorial summary",
      exams: "Evidence",
      questions: "Questions",
      completedSessions: "Completed sessions"
    },
    insights: {
      title: "Editorial Insights",
      subtitle: "See where the bank is most sensitive before editing or publishing.",
      captureSnapshot: "Register snapshot",
      summaryAriaLabel: "Editorial Signals Summary",
      questionsWithSignal: "Sign issues",
      totalAttempts: "Total attempts",
      averageError: "Average error",
      reviewPressure: "Review pressure",
      snapshots: "Snapshots",
      latestSnapshot: "Last snapshot",
      hardestQuestions: "Most sensitive issues",
      weakestDomains: "Weaker domains",
      weakestExams: "Tests with greater friction",
      noSignal: "There is still not enough signal to highlight issues.",
      noDomain: "No domain",
      noRelevantDomains: "No domains with relevant history yet.",
      noExamFriction: "No proof with consolidated friction yet."
    },
    users: {
      title: "Users and RBAC",
      subtitle: "Adjust paper and activation without leaving the panel.",
      loadError: "Unable to load users.",
      active: "Active",
      empty: "No users available.",
      accessDenied: "Only admins can change users and roles."
    },
    domainCatalog: {
      title: "Domain catalog",
      subtitle: "Consult objectives and blueprints with quick search.",
      certification: "Certification",
      search: "Search",
      loadError: "Unable to load the domain catalog.",
      empty: "No items found for current filters."
    },
    issues: {
      title: "Issue triage",
      subtitle: "Update status and link the corrected version without leaving the backlog.",
      loadError: "Unable to load the issues backlog.",
      detailTitle: "Issue detail",
      accessDenied: "Full screening requires reviewer or admin role.",
      assignVersion: "Link version",
      openQuestion: "Open question",
      empty: "No pending issues.",
      selectPrompt: "Select a backlog item to triage and record an internal note.",
      internalNote: "Internal comment",
      saveNote: "Save note",
      saved: "Update saved in the editorial backlog.",
      saveError: "Unable to update this issue now.",
      versionLinked: "Current version linked to the issue.",
      unassignedVersion: "No linked version",
      versionTag: "Version v{id}",
      triagedTag: "Tried",
      actions: {
        triage: "Triage",
        fixing: "In correction",
        verify: "Check",
        release: "Release",
        dismiss: "Dismiss"
      }
    },
    browser: {
      title: "Explore questions",
      subtitle: "Filter, browse and upload a question without leaving the same screen.",
      newQuestion: "New question",
      exam: "Exam",
      search: "Search",
      searchHint: "Search by ID, domain, certification or part of the statement.",
      refreshingList: "Updating list...",
      foundCount: "{count} question(s) found.",
      listAriaLabel: "List of questions",
      draftVersion: "draft v{version}",
      publishedVersion: "published v{version}",
      correctOptions: "{correct}/{count} correct",
      multi: "multi",
      single: "single",
      draft: "draft",
      empty:
        "No questions loaded. Please review editorial permission or adjust filters to continue."
    },
    examsManager: {
      title: "Test registration",
      subtitle: "Update the proof catalog without leaving the editor.",
      registeredExams: "Registered tests",
      examId: "test ID",
      questionCount: "Number of questions",
      titleLabel: "Title",
      source: "Source",
      sourceHint: "E.g.: questions/securityplus.json",
      noticeTitle: "Exam",
      saveExam: "Save test",
      clear: "Clear"
    },
    editor: {
      title: "Question Editor",
      subtitle:
        "Edit everything in a single flow: metadata, alternatives, justification, references and payload preview.",
      noticeTitle: "Question",
      validationTitle: "Validation",
      load: "Load",
      duplicate: "Duplicate",
      delete: "Delete",
      workflowTitle: "Editorial workflow",
      workflowSubtitle: "Actual flow: draft -> in_review -> approved -> published. Publication requires explicit approval.",
      statusCurrent: "Current status",
      draftCurrent: "Current draft",
      publishedCurrent: "Published",
      auditedEvents: "Audited events",
      snapshots: "Snapshots",
      stepSave: "1. Save draft",
      stepReview: "2. Submit for review",
      stepApprove: "3. Approve",
      stepPublish: "4. Publish",
      saveDraft: "Save draft",
      submitReview: "Submit for review",
      approve: "Approve",
      publish: "Publish",
      newDraft: "New draft",
      submitReviewHintReady: "Submit current draft for review",
      submitReviewHintBlocked: "Only drafts can proceed for review",
      approveHintReady: "Approve the version under review",
      approveHintBlocked: "Approval is only available for versions under review",
      publishHintReady: "Publish the approved version",
      publishHintBlocked: "Publication requires an approved version",
      versionsTitle: "Version history",
      versionsSubtitle: "Each publish or rollback generates a new trackable version.",
      versionPublishedAt: "Published in {date}",
      versionUpdatedAt: "Updated in {date}",
      currentPublishedTag: "Current published",
      currentDraftTag: "Current draft",
      rollbackVersion: "Revert to this version",
      noVersions: "No version registered yet. Save the first draft to start the flow.",
      auditTitle: "Audit",
      auditSubtitle: "Who changed, when they changed and for what reason.",
      auditSystem: "system",
      noAudit: "No audited events for this question yet.",
      performanceTitle: "Performance history",
      performanceSubtitle: "Snapshots preserve the difficulty reading of the published version over time.",
      versionUnknown: "No version",
      scoreLabel: "score {value}",
      errorRate: "error {value}%",
      attemptsCount: "{count} attempt(s)",
      lowConfidenceRate: "low confidence {value}%",
      pressureCount: "pressure {count}",
      noPerformance: "There is no historical snapshot for this question yet. Use “Register snapshot” at the top of the panel.",
      quickChecklistTitle: "Quick checklist",
      quickChecklistSubtitle: "Instant reading before saving.",
      payloadPreviewTitle: "Payload preview",
      payloadPreviewSubtitle: "This is the JSON sent to the backend with no hidden transformations.",
      diagnosticsEmpty: "Save or upload an issue to receive full editorial diagnostics from the backend."
    },
    misc: {
      panelLink: "Editorial panel",
      authRequired: "Log in with an authenticated admin account to continue.",
      adminOnly: "Only admin accounts can perform this operation.",
      actionFailed: "This action could not be completed.",
      loadOverview: "overview",
      loadAnalytics: "editorial analytics",
      loadQuestionList: "list of questions",
      loadIssues: "issue backlog",
      panelLoadFailed: "The editorial board could not be loaded.",
      questionLoaded: "Question {id} uploaded for editing.",
      questionLoadFailed: "This question could not be loaded.",
      freshDraftReady: "New draft ready for editing.",
      newDraftCreated: "New draft created. Fill in the fields and save.",
      duplicateReady: "Duplicate content. Set a new ID before saving.",
      panelRefreshed: "Updated editorial panel.",
      exportDone: "Export completed. The JSON file was generated by the real backend.",
      exportFailed: "Unable to export the bank now.",
      snapshotSchemaMissing: "The snapshot schema is not yet available. Run the migrations and try again.",
      snapshotRecorded: "Editorial snapshot recorded for {count} issue(s).",
      snapshotNone: "No questions eligible for snapshot at this time.",
      snapshotFailed: "Unable to register editorial snapshot.",
      examRequiredFields: "Fill in ID and title before saving.",
      examSaveFailed: "The test could not be saved.",
      questionSaveFailed: "The issue could not be saved.",
      reviewSendFailed: "The question could not be submitted for review.",
      approveFailed: "The issue could not be approved.",
      publishFailed: "The question could not be published.",
      loadBeforeRollback: "Please upload a question before reverting.",
      rollbackFailed: "The issue could not be reversed.",
      confirmDelete: "Delete question {id}? This action cannot be undone.",
      deleteFailed: "The issue could not be deleted.",
      questionDeleted: "Question {id} deleted.",
      editorRequiredAction: "This action requires an editor, reviewer or admin role.",
      adminRequiredAction: "This action requires admin role.",
      reviewerRequiredAction: "This action requires a reviewer or admin role."
    }
  },
  results: {
    errors: {
      loadResult: "The result of this session could not be loaded.",
      bannerTitle: "Unable to load result",
      missingReview: "The session returned no review data."
    },
    insights: {
      answered: "Answered: {count}",
      accuracy: "Accuracy: {value}%",
      averagePerQuestion: "Average per question: {value}s",
      weakestDomain: "Most sensitive domain: {label}",
      weakestDomainWithErrors: "Most sensitive domain: {label} ({count} error(s))",
      reviewDueAfter: "Queue expired after block: {count}"
    },
    readiness: {
      excellent: "Excellent",
      good: "Good",
      ok: "Okay",
      tuning: "In adjustment"
    },
    citations: {
      openMaterial: "Open material"
    },
    reviewBlock: {
      question: "Question {number}",
      noMetadata: "No metadata",
      correct: "Correct",
      wrong: "Wrong",
      correctSuffix: " (correct)",
      selectedSuffix: " (your choice)"
    },
    header: {
      title: "Session result",
      mixedSession: "Mixed session",
      completedAt: "completed in {date}"
    },
    summary: {
      studyTitle: "{score} study performance",
      examTitle: "score {score} · readiness {readiness}",
      strategySubtitle: "Strategy {strategy}.",
      score: "Score",
      readiness: "Readiness",
      correct: "Hits",
      wrong: "Errors",
      answered: "Answered",
      questions: "Questions",
      timeUsed: "Time used",
      timeLimit: "Limit",
      timedOutTitle: "Simulation ended by time",
      timedOutMessage:
        "The backend applied auto-submit when the timer reset. Review the incorrect and unanswered items first."
    },
    reviewCard: {
      title: "Guided review",
      subtitle: "Open each question only when you need to review the detail.",
      questionCount: "{count} questions",
      empty: "No questions were found for this review."
    },
    readinessCard: {
      title: "Readiness Score",
      subtitle: "Current {current} · projected {projected}",
      band: "Range",
      suggestedSession: "Suggested session",
      trackedBase: "Base tracked",
      byDomain: "Domain by domain",
      accuracy: "hit {value}",
      pace: "rhythm {value}",
      lowConfidence: "low confidence {count}"
    },
    timingCard: {
      title: "Session rhythm",
      subtitle: "Speed and dispersion now explicitly enter the readiness reading.",
      duration: "Duration",
      averagePerQuestion: "Average per question",
      fastest: "Faster",
      slowest: "Slower"
    },
    studyPlanCard: {
      title: "Recommended plan (15-45 min)",
      subtitle: "Prioritize the highest friction domains and jump straight into focused review.",
      openReview: "Start review",
      openReferences: "Open references"
    },
    tutor: {
      title: "Question tutor",
      explain: "Explain to me",
      whyWrong: "Why was I wrong?",
      reviewTopic: "Review subject",
      loading: "Consulting tutor...",
      unavailable: "Tutor unavailable",
      blocked: "Tutor blocked this review",
      answered: "Tutor replied"
    },
    issueReport: {
      title: "Report issue",
      clarity: "Clarity",
      answerKey: "Answer key",
      explanation: "Explanation",
      reference: "Reference",
      send: "Send report",
      success: "Report sent to the editorial backlog.",
      failure: "Unable to report this issue now."
    }
  },
  runner: {
    errors: {
      loadSession: "This session could not be loaded.",
      openSessionTitle: "Unable to open session",
      examPausedTitle: "Simulation paused",
      examPausedMessage: "Responses are blocked while pause is active."
    },
    navigator: {
      title: "Navigation",
      examTitle: "Exam navigator",
      minimalSubtitle: "Lean flow, without pedagogical resources.",
      examSubtitle: "Go back and forth freely before submitting.",
      pending: "Pending: {count}",
      flagged: "Marked: {count}",
      loading: "Loading test status...",
      empty: "No browser data yet."
    },
    examDay: {
      tag: "Exam day",
      activeTitle: "Test mode active",
      activeMessage: "Instant correction, tutor, references and quick exits have been reduced to simulate test day.",
      answerRecordedTitle: "Answer recorded",
      answerRecordedMessage: "In exam mode, the answer key and detailed analysis appear only after final submission."
    },
    tags: {
      markedForReview: "Marked for review"
    },
    actions: {
      unmarkReview: "Unmark review",
      markReview: "Mark for review",
      previous: "Previous",
      confirmAnswer: "Confirm answer"
    },
    tutor: {
      title: "Question tutor",
      subtitle: "Available after answering, without leaving the test.",
      explain: "Explain to me",
      whyWrong: "Why was I wrong?",
      reviewTopic: "Review subject"
    },
    issueReport: {
      title: "Report issue",
      subtitle: "This feeds the editorial backlog.",
      category: "Category",
      detail: "Detail",
      clarity: "Clarity",
      answerKey: "Answer key",
      explanation: "Explanation",
      reference: "Reference",
      send: "Send report",
      success: "Report sent to the editorial backlog."
    },
    header: {
      studyTitle: "Study mode",
      examTitle: "Exam mode",
      subtitle: "Question at the center. Support tools on the side."
    },
    questionCard: {
      title: "Question {current} from {total}",
      singleSelect: "Select an alternative.",
      multiSelect: "Select all correct alternatives.",
      optionsAriaLabel: "Alternatives",
      answered: "{count} answered",
      examSummary: "{correct} correct · {wrong} errors",
      paused: "Paused",
      time: "Time"
    },
    feedback: {
      correct: "Correct answer",
      wrong: "Incorrect answer",
      missingJustification: "No justification given for this issue. Review the topic and move on to the next one."
    },
    labels: {
      confidence: "Confidence",
      noActiveQuestion: "No active questions found for this session.",
      tools: "Tools",
      hints: "Hints",
      hintsSubtitle: "Open only when you need a push.",
      notes: "Notes",
      notesSubtitle: "Mark and record context only when useful.",
      references: "References",
      referencesHintAria: "References suggested by the hint",
      referencesOfficialAria: "Official references",
      questionToolsAria: "Question tools",
      level: "Level {level}",
      openExcerpt: "Open snippet",
      reviewLater: "Mark for later review",
      note: "Note",
      save: "Save",
      reload: "Reload",
      examFocusOnly: "In the simulation, stay focused on the question. The detailed review appears in the final result."
    },
    notices: {
      loadingStudyState: "Loading study status...",
      savingStudyState: "Saving study status...",
      syncedAt: "Synced at {date} ({scope}).",
      noSavedNotes: "No saved notes yet ({scope}).",
      savedAt: "Saved at {date} ({scope}).",
      syncedStatus: "Status synced ({scope}).",
      saveFailed: "Unable to save: {error}",
      examPaused: "Simulation paused. The timer was frozen within the configured limit.",
      examResumed: "Simulation resumed. The timer started counting again."
    },
    studyState: {
      pendingChanges: "Pending changes..."
    },
    hints: {
      hintButton: "Hint {level}"
    },
    liveFeedback: {
      remaining: "Remaining: {count}",
      currentStreak: "Current streak: {count}",
      uncertainCorrect: "Correct but uncertain: keep it in the reinforcement signal.",
      nextReview: "Next review: {date}",
      dueQueue: "Due queue: {count}"
    }
  }
} as const;

export type EnUSMessages = typeof enUSMessages;

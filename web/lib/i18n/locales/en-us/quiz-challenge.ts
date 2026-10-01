/** Sentinel Arena: self-paced challenges (Incremento 6). */
export const quizChallenge = {
  meta: {
    playTitle: "Challenge",
    panelTitle: "Challenge panel"
  },
  states: {
    scheduled: "Scheduled",
    open: "Open",
    closed: "Closed"
  },
  reasons: {
    completed: "Completed",
    time_up: "Time's up",
    closed: "Deadline passed",
    handed_in: "Handed in early"
  },
  repeat: {
    badge: "Repeat?",
    hint: "Someone had already played from this device under another name. It may be the same person trying again."
  },
  sessions: {
    badge: "Challenge",
    panel: "Panel"
  },
  funnel: {
    title: "Funnel",
    description: "How many people reached each step, from opening the link to finishing an attempt.",
    opened: "Opened the link",
    joined: "Joined",
    started: "Started",
    finished: "Finished",
    value: "{label}: {count}"
  },
  attempts: {
    title: "Attempts per person",
    none: "Nobody has started yet.",
    one: "1 attempt",
    many: "{count} attempts",
    peopleOne: "1 person",
    people: "{count} people"
  },
  create: {
    title: "Create challenge",
    short: "Challenge",
    description: "Creates a link that each person answers at their own pace, until the deadline. Nobody needs to be live.",
    mustPublishTitle: "Publish first",
    mustPublish: "A challenge uses the published version of the quiz. Publish the quiz to create a challenge.",
    usesPublished: "The challenge uses the published version (v{version}). Unpublished changes are left out.",
    window: {
      legend: "When",
      opens: "Opening",
      now: "Now",
      later: "Schedule",
      opensAt: "Opening date and time",
      closesAt: "Deadline",
      closesHint: "The challenge closes on its own at this time (up to 90 days after opening).",
      shortcuts: "Deadline shortcuts",
      shortcut1: "1 day",
      shortcut3: "3 days",
      shortcut7: "1 week"
    },
    attempts: {
      label: "Attempts per person",
      hint: "Each person's best attempt counts for the ranking and the report.",
      one: "1 attempt",
      many: "{count} attempts"
    },
    time: {
      legend: "Time",
      per_item: {
        name: "Per question",
        description: "Each question uses the time set in the quiz (with extended time for whoever needs it)."
      },
      total: {
        name: "Total time",
        description: "A single clock for the whole attempt."
      },
      none: {
        name: "No timer",
        description: "Everyone answers calmly, until the challenge deadline."
      },
      minutes: "Minutes for the attempt",
      minutesHint: "From 1 to 240 minutes."
    },
    feedback: {
      legend: "Answer key",
      hint: "When each person sees whether they got it right, the correct answer and the explanation.",
      default: "Recommended",
      each: {
        name: "After each question",
        description: "Right after answering. Great for studying; makes it easier to pass answers around."
      },
      end: {
        name: "At the end",
        description: "When the person finishes the attempt, with all answers at once."
      },
      after_close: {
        name: "After the deadline",
        description: "Only when the challenge closes. Best with a ranking: nobody sees the key before the others."
      },
      never: {
        name: "Never",
        description: "People see only their score. Useful for assessments you will reuse."
      }
    },
    leaderboard: {
      label: "Show ranking",
      description: "Participants see their own position and the top 10.",
      hintTitle: "Tip:",
      hint: "with a ranking, the answer key waits until the deadline and requiring sign-in is worth it. That makes it harder for someone to join under another name just to replay the challenge.",
      requireLogin: "Require sign-in"
    },
    shuffle: {
      label: "Shuffle questions and options",
      description: "Every attempt gets a different order. Content slides stay in place."
    },
    requireLogin: {
      label: "Require sign-in",
      description: "Only people signed in with a Sentinel account can take part."
    },
    requireLoginAndCreate: "Require sign-in and create",
    submit: "Create challenge",
    submitting: "Creating...",
    errors: {
      opensRequired: "Enter the opening date and time.",
      opensPast: "That opening time has passed. Pick a future time or open now.",
      closesRequired: "Enter the deadline.",
      closesPast: "The deadline must be at least one minute in the future.",
      closesBeforeOpens: "The deadline must be after the opening.",
      windowTooLong: "A challenge can stay open for at most 90 days.",
      totalRange: "Use a whole number from 1 to 240 minutes.",
      attemptsRange: "Choose 1 to 5 attempts.",
      invalid_window: "Check the dates: the deadline must be in the future, after the opening and within 90 days.",
      invalid_total_time: "The total time must be between 1 and 240 minutes.",
      invalid_attempts: "Choose 1 to 5 attempts.",
      invalid_feedback: "Choose an answer key option.",
      invalid_time_mode: "Choose a time option.",
      no_interactive: "The quiz needs at least one question.",
      quiz_not_published: "Publish the quiz before creating a challenge.",
      challenge_closed: "This challenge is already closed.",
      challenge_not_found: "Challenge not found.",
      slug_exhausted: "Could not create the link right now. Try again.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Could not finish. Try again."
    }
  },
  panel: {
    back: "Back to sessions",
    window: "From {opens} to {closes}",
    opensIn: "Opens in {time}",
    closesIn: "Closes in {time}",
    updated: "Updated {time}",
    refreshing: "refreshing…",
    loadError: "Could not load the challenge.",
    notFound: "Challenge not found.",
    postpone: "Extend deadline",
    closeNow: "Close now",
    report: "View report",
    stats: {
      inProgress: "Answering now",
      attempts: "Attempts",
      median: "Median duration",
      repeat: "Possible repeats"
    },
    leaderboard: {
      title: "Ranking (top 10)",
      empty: "Nobody has finished an attempt yet.",
      rank: "#",
      name: "Name",
      score: "Points",
      correct: "Correct"
    },
    recent: {
      title: "Recent finishes",
      empty: "Finished attempts show up here.",
      attempt: "Attempt {n}",
      score: "{score} pts · {correct} correct"
    },
    share: {
      title: "Challenge link",
      text: "Share the link or the QR code. It works until the deadline.",
      qrLabel: "QR code for the challenge {title}",
      copy: "Copy link",
      copied: "Link copied",
      qr: "Printable QR"
    },
    settings: {
      title: "Settings",
      attempts: "Attempts per person",
      time: "Time",
      totalMinutes: "{minutes} min in total",
      feedback: "Answer key",
      leaderboard: "Ranking",
      shuffle: "Shuffle",
      access: "Access",
      yes: "Yes",
      no: "No"
    },
    postponeDialog: {
      title: "Extend deadline",
      description: "Pick the new deadline. Attempts in progress with a total time follow the new end.",
      save: "Save deadline",
      plus1: "+1 day",
      plus3: "+3 days",
      plus7: "+1 week"
    },
    closeConfirm: {
      title: "Close the challenge now?",
      message: "Nobody can join or answer anymore. Attempts in progress end as they are and the ranking becomes final.",
      confirm: "Close now"
    }
  },
  report: {
    title: "Challenge",
    description: "One attempt counts per person: their best finished one. People who never finished are left out of the report; the funnel shows the difference.",
    attempts: "Total attempts",
    median: "Median duration",
    repeat: "Possible repeats",
    repeatHint: "Attempts marked “Repeat?” came from a device someone else had already used. Worth checking before awarding prizes.",
    open: "The challenge is still open: the numbers change until the deadline."
  },
  play: {
    brand: "Sentinel Arena · Challenge",
    loading: "Loading the challenge...",
    deadline: "Deadline: {date}",
    errors: {
      challenge_not_found: "We could not find this challenge. Check the link.",
      challenge_not_open: "This challenge has not opened yet.",
      challenge_closed: "This challenge is closed.",
      login_required: "This challenge requires sign-in. Sign in with your account to take part.",
      name_taken: "That name is already taken in this challenge. Pick another one.",
      name_rejected: "That name cannot be used. Pick another one.",
      consent_required: "Tick the consent box to join.",
      room_full: "The challenge reached its participant limit.",
      rate_limited: "Too many tries in a row. Wait a moment and try again.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Something went wrong. Try again."
    },
    attemptErrors: {
      attempts_exhausted: "You have used every attempt of this challenge.",
      challenge_not_open: "This challenge has not opened yet.",
      challenge_closed: "This challenge is closed.",
      attempt_not_found: "You have not started this challenge yet.",
      challenge_empty: "This challenge has no questions left.",
      banned: "You were removed from this challenge.",
      token: "Your session expired. Come back with your return code.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Something went wrong. Try again."
    },
    join: {
      subtitle: "Your name shows up in the ranking and in the creator's report.",
      submit: "Join the challenge"
    },
    scheduled: {
      title: "Not open yet",
      opensAt: "Opens on {date}",
      countdown: "Opens in {time}",
      text: "Keep this page open: it refreshes by itself when the challenge opens."
    },
    open: {
      closesIn: "Closes in {time}",
      continueTitle: "You are already in this challenge",
      continueAs: "Continue as {name}",
      continueText: "To continue on this device, confirm with the return code you got when you joined.",
      continue: "Continue",
      notYou: "Not you? Join with another name"
    },
    closed: {
      title: "Challenge closed",
      text: "The deadline was {date}.",
      resultsTitle: "Did you take part?",
      resultsText: "Use your name and the return code you got when you joined to see your score and the answer key.",
      resultsCta: "See my results"
    },
    rules: {
      kicker: "Before you start",
      title: "How it works",
      questionsOne: "1 question",
      questions: "{count} questions",
      time: {
        per_item: "Each question has its own timer",
        total: "{minutes} minutes for the whole attempt",
        none: "No timer: answer calmly until the deadline"
      },
      attemptsOne: "1 attempt",
      attempts: "{count} attempts",
      feedback: {
        each: "You see the answer key right after each answer",
        end: "You see the answer key when you finish",
        after_close: "The answer key comes out after the deadline ({date})",
        never: "This challenge shows only the score, no answer key"
      },
      leaderboard: "There is a ranking",
      noLeaderboard: "No ranking",
      bestCounts: "Your best attempt counts.",
      start: "Start",
      starting: "Getting ready...",
      noAttempt: "You did not make any attempt in this challenge."
    },
    game: {
      progress: "Item {current} of {total}",
      progressLabel: "Challenge progress",
      totalLeftSr: "Total time left: {time}",
      timeWarn: "{seconds} seconds left",
      handIn: "Hand in",
      handInTitle: "Hand in now?",
      handInText: "The remaining questions stay unanswered and the attempt ends. This cannot be undone.",
      handInConfirm: "Hand in",
      handInCancel: "Keep answering",
      contentContinue: "Continue",
      timeUp: "Time's up",
      timeUpWaiting: "Moving on...",
      timeUpStuck: "We could not refresh. Tap to try again.",
      sending: "Sending...",
      sendFailed: "Your answer was not sent. It is kept: try again.",
      resend: "Send again",
      invalid: "We could not read that answer. Try again.",
      stale: "Your attempt moved on in another tab. Showing where it is.",
      closed: "This attempt has already ended.",
      next: "Next",
      loadingNext: "Loading the next one...",
      seeResult: "See result"
    },
    announce: {
      item: "Item {current} of {total}: {prompt}",
      feedback: "Answer feedback",
      finished: "Attempt finished"
    },
    summary: {
      title: "Attempt finished",
      reasons: {
        completed: "You answered everything.",
        time_up: "Time ran out.",
        closed: "The challenge deadline passed.",
        handed_in: "You handed in before the end."
      },
      score: "{score} points",
      correctLabel: "Correct",
      correct: "{correct} of {total}",
      answeredLabel: "Answered",
      answered: "{answered} of {total}",
      durationLabel: "Duration",
      rankLabel: "Position",
      rank: "{rank} of {total}",
      attemptsUsedLabel: "Attempts used",
      attemptOf: "{n} of {total}",
      best: "Your best score: {score}",
      tryAgain: "Try again",
      attemptsLeftOne: "1 attempt left.",
      attemptsLeft: "{count} attempts left.",
      noAttemptsLeft: "You have used every attempt.",
      corrections: {
        title: "Answer key",
        hiddenAfterClose: "The answer key comes out after the deadline, on {date}. Come back through this same link.",
        hiddenNever: "This challenge does not show the answer key.",
        item: "Question {n}",
        yourAnswer: "Your answer",
        correctAnswer: "Correct answer",
        noAnswer: "No answer",
        points: "+{points} pts",
        status: {
          correct: "Correct",
          incorrect: "Wrong",
          partial: "Partial",
          noAnswer: "No answer",
          notScored: "Not scored"
        }
      }
    },
    leaderboard: {
      title: "Provisional ranking",
      final: "Final ranking",
      provisional: "Changes until the deadline",
      yourPosition: "Your position: {rank} of {total}",
      notRanked: "You join the ranking when you finish an attempt.",
      you: "you",
      points: "points",
      error: "Could not load the ranking."
    }
  }
} as const;

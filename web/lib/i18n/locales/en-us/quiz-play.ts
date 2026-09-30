export const quizPlay = {
  meta: {
    entryTitle: "Join a live quiz",
    roomTitle: "Live quiz"
  },
  brand: "Sentinel Arena",
  entry: {
    title: "Join the quiz",
    subtitle: "Enter the 6-digit PIN shown on the big screen.",
    label: "Room PIN",
    submit: "Join",
    checking: "Looking for the room...",
    pasteHint: "You can also paste the PIN or the link.",
    invalid: "The PIN has 6 digits and does not start with zero."
  },
  room: {
    loading: "Loading the room...",
    pin: "PIN {code}",
    participants: "{count} in the room",
    changeCode: "Use another PIN",
    retry: "Try again"
  },
  join: {
    title: "How should we call you?",
    subtitle: "Your name shows on the big screen and on the leaderboard.",
    nameLabel: "Your name",
    namePlaceholder: "e.g. Swift Firewall",
    nameHint: "2 to 24 characters. Avoid personal data.",
    nameTooShort: "Use at least 2 characters.",
    nameTooLong: "Use at most 24 characters.",
    suggest: "Suggest a name",
    suggesting: "Suggesting...",
    suggestFailed: "Could not suggest a name right now. Try again.",
    consentLabel: "I agree to the use of my name and answers in this session.",
    consentText:
      "We use your name and answers only for this quiz and the presenter's report (LGPD, terms {version}). We never ask for your email or contact details.",
    consentRequired: "Tick the consent box to join.",
    submit: "Join the room",
    submitting: "Joining...",
    signIn: "Sign in with my account",
    haveReturnCode: "I joined before and have a return code",
    loginOnlyTitle: "This room requires sign-in",
    loginOnlyText: "The presenter asked everyone to join with a Sentinel account.",
    closedTitle: "Joining is closed",
    closedText: "The presenter is not accepting new participants right now. If you were already in, use your return code."
  },
  rejoin: {
    title: "Back to the room",
    subtitle: "Use the same name and the return code you got when you joined.",
    codeLabel: "Return code",
    codePlaceholder: "e.g. K7Q-2MX",
    codeRequired: "Enter your return code.",
    submit: "Back to the room",
    submitting: "Rejoining...",
    back: "Join as a new participant"
  },
  returnCode: {
    title: "You're in!",
    subtitle: "Keep this code. It gets you back into the room if you close the tab or switch devices.",
    label: "Your return code",
    copy: "Copy",
    copied: "Copied!",
    continue: "Got it, continue",
    showAgain: "Show my return code",
    hide: "Hide code"
  },
  errors: {
    room_not_found: "We could not find a room with that PIN. Check the digits on the big screen.",
    room_locked: "The presenter locked the room. Ask them to open it.",
    room_full: "The room is full. Talk to the presenter.",
    session_finished: "This session has already ended.",
    login_required: "This room requires sign-in. Sign in with your account to take part.",
    name_taken: "Someone already uses that name. Pick another or use your return code.",
    name_rejected: "That name is not allowed. Pick another or use the suggestion.",
    consent_required: "Tick the consent box to join.",
    invalid_return_code: "The return code does not match that name. Check it and try again.",
    rate_limited: "Lots of people joining at once. Try again in a few seconds.",
    offline: "No internet connection. Check your network and try again.",
    generic: "Something went wrong. Try again.",
    tokenLost: "Your entry expired. Rejoin with your name and return code."
  },
  connection: {
    connecting: "Connecting...",
    reconnecting: "Unstable connection. Reconnecting...",
    offline: "You are offline. We will reconnect as soon as the network is back.",
    retry: "Reconnect",
    closed: {
      auth: "Your entry is no longer valid.",
      token_expired: "Your entry expired.",
      kicked: "The presenter removed you from this session.",
      banned: "The presenter blocked you from this session.",
      room_full: "The room is full.",
      session_ended: "The session has ended.",
      protocol: "Your app is out of date. Reload the page.",
      policy: "The server refused the connection.",
      generic: "The connection was closed."
    }
  },
  lobby: {
    title: "You're in!",
    findYourName: "Look for your name on the big screen.",
    waiting: "Waiting for the presenter...",
    count: "{count} people in the room",
    notYou: "Not you? Leave"
  },
  question: {
    counter: "Question {current} of {total}",
    getReady: "Get ready",
    opensIn: "Answers in {seconds}",
    timeLeft: "{seconds} seconds left",
    readingSr: "Read the question. Answers open in {seconds} seconds.",
    points: "{multiplier}x points",
    noPoints: "No points",
    poll: "Poll",
    selectN: "Select {count}",
    selectAny: "Select one or more",
    selectedCount: "{count} selected",
    send: "Submit",
    typeLabel: "Your answer",
    typePlaceholder: "Type your answer",
    choose: "Choose an option",
    option: "{letter}: {text}"
  },
  submitted: {
    title: "Answer sent!",
    sending: "Sending...",
    waiting: "Waiting for the others...",
    yourChoice: "Your answer",
    progress: "{answered} of {total} answered",
    rejected: {
      late: "Time ran out before your answer arrived.",
      closed: "The question was already closed.",
      invalid: "We could not record that answer. Try again."
    }
  },
  locked: {
    title: "Answers locked",
    subtitle: "Results coming up...",
    missed: "You did not answer this one."
  },
  reveal: {
    correct: "Correct!",
    incorrect: "Not this time",
    partial: "Partially correct",
    noAnswer: "Time's up",
    pollDone: "Vote recorded",
    recorded: "Answer recorded",
    correctWas: "The correct answer was {answer}",
    acceptedWere: "Accepted answers: {answer}",
    points: "+{points}",
    pointsLabel: "points on this question",
    streak: "{count} in a row",
    rank: "#{rank}",
    rankUp: "up {n}",
    rankDown: "down {n}",
    total: "{score} points in total",
    encouragement: "Keep going! The next one is yours.",
    explanation: "Why?"
  },
  leaderboard: {
    title: "Leaderboard",
    yourPosition: "Your position",
    behind: "{points} points behind #{rank}",
    leading: "You are in the lead!",
    score: "{score} points",
    notRanked: "Answer the questions to get on the leaderboard."
  },
  content: {
    title: "Follow along on the big screen"
  },
  final: {
    title: "Game over!",
    place: "You finished #{rank} of {total}",
    score: "{score} points",
    thanks: "Thanks for playing!",
    podiumWait: "Look at the big screen: the podium is coming up!",
    viewResults: "See my answers",
    hideResults: "Hide my answers"
  },
  results: {
    title: "Your answers",
    loading: "Loading your answers...",
    error: "Could not load your answers.",
    summary: "{correct} correct out of {total} scored questions",
    item: "Question {position}",
    yourAnswer: "Your answer",
    correctAnswer: "Correct answer",
    noAnswer: "No answer",
    correct: "Correct",
    incorrect: "Incorrect",
    partial: "Partial",
    notScored: "Not scored",
    points: "{points} pts"
  },
  kicked: {
    title: "You left the room",
    back: "Back to start"
  },
  leave: {
    confirmTitle: "Leave this room?",
    confirmText: "You can come back later with the same name and your return code.",
    confirm: "Leave",
    cancel: "Stay in the room"
  },
  announce: {
    lobby: "You are in the room. Waiting for the presenter.",
    question: "Question {current} of {total}: {prompt}",
    open: "Answers are open.",
    locked: "Answers locked.",
    reveal: "Question results.",
    leaderboard: "Leaderboard.",
    podium: "Final podium.",
    finished: "Session ended.",
    submitted: "Answer sent."
  }
} as const;

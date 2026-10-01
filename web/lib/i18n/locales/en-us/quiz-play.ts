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
    closedText: "The presenter is not accepting new participants right now. If you were already in, use your return code.",
    approvalNotice: "The presenter lets each person in. After joining, wait a moment in the waiting room.",
    fullNotice: "The room is full right now. You join the queue and get in as soon as a seat frees up."
  },
  waiting: {
    title: "Waiting room",
    approvalTitle: "Waiting for the presenter to let you in",
    approvalText: "As soon as the presenter approves, you enter the room on your own.",
    capacityTitle: "The room is full",
    position: "You are number {position} in line",
    positionNext: "You are next in line",
    waitingOne: "1 person waiting",
    waitingMany: "{count} people waiting",
    keepOpen: "Keep this tab open: when it is your turn, you get in on your own.",
    reconnecting: "No answer from the server. Trying again...",
    leave: "Leave the queue",
    leaving: "Leaving...",
    announceApproval: "You are in the waiting room. Waiting for the presenter to let you in.",
    announcePosition: "You are number {position} in line.",
    admitted: "You are in the room!",
    retry: "Try again",
    ended: {
      rejected: {
        title: "Entry not approved",
        text: "The presenter did not let you into this room."
      },
      expired: {
        title: "Your turn has passed",
        text: "The session ended or your place expired because the tab was closed for too long."
      },
      withdrawn: {
        title: "You left the queue",
        text: "Your place in line was released."
      },
      invalid: {
        title: "Your place in line is no longer valid",
        text: "You joined the queue from another tab or device. Join again to get a place."
      }
    }
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
    room_full: "The room and its waiting line are full. Talk to the presenter.",
    session_finished: "This session has already ended.",
    login_required: "This room requires sign-in. Sign in with your account to take part.",
    name_taken: "Someone already uses that name. Pick another or use your return code.",
    name_rejected: "That name is not allowed. Pick another or use the suggestion.",
    consent_required: "Tick the consent box to join.",
    invalid_return_code: "The return code does not match that name. Check it and try again.",
    invalid_wait_token: "Your place in line is no longer valid. Join again.",
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
    transportSse: "Fallback connection",
    transportSseHint: "Your network blocked the real-time connection. We switched to a fallback connection; everything keeps working.",
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
    option: "{letter}: {text}",
    extendedTime: "Extended time: {multiplier}×",
    untimed: "No time limit",
    untimedHint: "Take all the time you need for this question."
  },
  ordering: {
    hint: "Put them in the right order: use the arrows or drag by the handle.",
    moved: "“{text}” is now in position {position} of {total}.",
    moveUp: "Move “{text}” up (position {position})",
    moveDown: "Move “{text}” down (position {position})",
    submit: "Submit order"
  },
  numeric: {
    label: "Your number",
    range: "Between {min} and {max}",
    invalid: "That is not a number. Use, for example, 1,234.5.",
    outOfRange: "Use a number between {min} and {max}.",
    slider: "Or adjust it with the slider"
  },
  words: {
    hintOne: "Send one word or short phrase.",
    hintMany: "Send up to {count} words or short phrases.",
    labelOne: "Your word",
    label: "Word {n}",
    placeholder: "E.g. Zero Trust",
    counter: "{count}/{max}",
    repeated: "Repeated words count only once.",
    sendMany: "Send {count} words"
  },
  paused: {
    title: "The host paused",
    subtitle: "The timer is frozen. You pick up where you left off when the question resumes.",
    timeLeft: "{seconds} seconds left when it resumes"
  },
  submitted: {
    title: "Answer sent!",
    sending: "Sending...",
    waiting: "Waiting for the others...",
    yourChoice: "Your answer",
    yourOrder: "Your order",
    yourWords: "Your words",
    progress: "{answered} of {total} answered",
    rejected: {
      late: "Time ran out before your answer arrived.",
      closed: "The question was already closed.",
      invalid: "We could not record that answer. Try again.",
      paused: "The question was paused and your answer was not recorded. Answer again when the host resumes."
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
    correctOrder: "Correct order",
    youPlaced: "You placed: {text}",
    slotRight: "right position",
    slotWrong: "wrong position",
    numericAnswer: "Answer:",
    numericYours: "You:",
    yourWords: "Your words: {words}",
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
    submitted: "Answer sent.",
    paused: "The host paused the question.",
    resumed: "Question resumed. Answers are open."
  },
  menu: {
    label: "More options",
    report: "Report",
    myData: "My data",
    reportQuestion: "Report this question"
  },
  report: {
    title: "Report",
    subtitle: "The moderation team reviews every report. The presenter does not see who reported.",
    targetLabel: "What do you want to report?",
    targetItem: "This question (item {position})",
    targetSession: "The whole session",
    reasonLabel: "Reason",
    reasons: {
      offensive: "Offensive content",
      spam: "Spam or advertising",
      cheating: "Cheating or fraud",
      copyright: "Copyright",
      privacy: "Personal data exposed",
      other: "Something else"
    },
    noteLabel: "Details (optional)",
    noteHint: "Up to 500 characters. Do not include personal data.",
    noteCount: "{count}/{max}",
    reasonRequired: "Choose a reason.",
    submit: "Send report",
    submitting: "Sending…",
    cancel: "Cancel",
    success: "Report sent. Thanks for helping keep the room safe.",
    errors: {
      too_many_reports: "You already sent several reports; the team is reviewing them. Try again later.",
      token: "Your participation expired. Join again to report.",
      invalid_item: "This item no longer exists. Report the session instead.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Could not send the report. Try again."
    }
  },
  myData: {
    title: "My data",
    subtitle: "What this room keeps about you (LGPD, art. 18).",
    link: "My data and privacy",
    loading: "Loading your data…",
    error: "Could not load your data.",
    retry: "Try again",
    close: "Close",
    profile: "Participation",
    name: "Name",
    joined: "Joined at",
    lastSeen: "Last seen",
    consent: "Accepted terms",
    account: "Linked account",
    accountYes: "Yes",
    accountNo: "No (guest)",
    score: "Final score",
    rank: "Final place",
    session: "Session",
    sessionStatus: {
      lobby: "Waiting to start",
      live: "In progress",
      finished: "Ended"
    },
    none: "—",
    answersTitle: "Your answers ({count})",
    noAnswers: "No answers recorded.",
    answerItem: "Item {position}",
    answerCorrect: "Correct",
    answerIncorrect: "Incorrect",
    answerNotScored: "Not scored",
    answerPoints: "{points} pts",
    retention: "Answers stay only as anonymous session statistics; names are anonymized by the retention policy.",
    eraseTitle: "Delete my data",
    eraseText: "Your name is replaced by “Removed participant”, you leave the leaderboard and the named reports, and this participation can no longer be linked to an account. Answers remain only as anonymous statistics. This cannot be undone.",
    eraseAction: "Delete my data",
    eraseConfirm: "Delete permanently",
    eraseCancel: "Keep my data",
    erasing: "Deleting…",
    eraseError: "Could not delete your data. Try again.",
    noParticipation: "You have not joined this room yet. After joining, open “My data” from the screen menu to see or delete what we keep.",
    rightsText: "We keep your nickname, your answers and their times for this session only. You can see and delete this data at any time."
  },
  access: {
    title: "Confirm it is you",
    subtitle: "Your session expired on this device. Use the name and the return code shown when you joined.",
    nameLabel: "Your name in the room",
    codeLabel: "Return code",
    codePlaceholder: "E.g. K7Q2MX",
    submit: "Continue",
    submitting: "Checking…",
    required: "Fill in the name and the return code.",
    noSession: "We could not find the session on this device. Open the room link to access your data.",
    errors: {
      invalid_return_code: "Name or return code does not match.",
      too_many_attempts: "Too many attempts. Wait 15 minutes and try again.",
      banned: "You were removed from this room.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Could not continue right now. Try again."
    }
  },
  claim: {
    title: "Save my result to my account",
    text: "Link this participation to your account until {date}. Answers to Question Bank items join your study progress.",
    textNoDate: "Link this participation to your account. Answers to Question Bank items join your study progress.",
    cta: "Save my result to my account",
    signedInAs: "Signed in as {email}",
    login: "Sign in to save",
    register: "Create an account",
    busy: "Saving…",
    successTitle: "Result saved to your account",
    successBank: "{count} Question Bank answers joined your progress.",
    successNoBank: "No question in this session came from the Question Bank, so your study progress did not change.",
    errors: {
      claim_session_active: "The session is still running. Save it once it ends.",
      claim_already_linked: "This participation is already linked to an account.",
      claim_expired: "The time to save has passed (7 days after the session ended).",
      claim_not_available: "This session does not allow saving results to accounts.",
      claim_already_in_session: "Your account already has a participation in this session.",
      login_required: "Sign in to save your result.",
      token: "Your participation expired on this device. Confirm with your return code.",
      offline: "You are offline. Check your connection and try again.",
      generic: "Could not save right now. Try again."
    }
  },
  removed: {
    title: "Content removed by moderation",
    text: "This item was taken down and is not scored. Wait for the next one."
  },
  afterSession: {
    title: "Already took part in this session?",
    text: "See your results and your data, or save the result to your account, with your name and return code.",
    cta: "See my results and data",
    back: "Back",
    resultsTab: "Results",
    dataTab: "My data"
  },
  erased: {
    title: "Your data was deleted",
    text: "You left the leaderboard and the reports. This device's credentials were cleared.",
    back: "Join another room"
  },
  toast: {
    dismiss: "Dismiss notice"
  }
} as const;

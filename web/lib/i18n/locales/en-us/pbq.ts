export const pbq = {
  badge: "PBQ",
  formatLabel: "Performance-based question (PBQ)",
  subtitle: "Performance-based question: solve every task, then confirm.",
  scenario: "Scenario",
  exhibits: "Exhibits",
  exhibitFallbackTitle: "Exhibit {number}",
  taskHeading: "Task {current} of {total}",
  taskWeight: "Weight {weight}",
  tasksComplete: "Completed tasks: {complete} of {total}",
  keyboardHelp: "Use Tab to move between tasks. Every drag action has a button (Up/Down) or select-list alternative.",
  ordering: {
    listLabel: "Items in the current order",
    moveUp: "Up: move “{item}” up",
    moveDown: "Down: move “{item}” down",
    moveUpShort: "Up",
    moveDownShort: "Down",
    moved: "“{item}” moved to position {position} of {total}.",
    dragHint: "Drag the items or use the Up and Down buttons.",
    correctPosition: "Correct position",
    expectedPosition: "Correct position: {position}",
    correctOrder: "Correct order"
  },
  categorization: {
    pool: "Uncategorized items",
    poolEmpty: "Every item has been categorized.",
    bucketEmpty: "Drop items here.",
    selectLabel: "Category of “{item}”",
    unassigned: "Uncategorized",
    assigned: "“{item}” placed in “{bucket}”.",
    unassignedAnnounce: "“{item}” moved back to the uncategorized items.",
    dragHint: "Drag each item to a category or pick the category in the item's own list.",
    bucketCount: "{count} items",
    progress: "{done} of {total} items categorized",
    expected: "Correct: {bucket}"
  },
  matching: {
    selectLabel: "Match for “{item}”",
    placeholder: "Select...",
    paired: "“{left}” matched with “{right}”.",
    cleared: "Match for “{left}” removed.",
    reused: "“{right}” was removed from “{left}”: each option can only be used once.",
    noReuseHint: "Each right-hand option can be used at most once.",
    reuseHint: "The same right-hand option can be used more than once.",
    inUse: "{choice} (in use)",
    progress: "{done} of {total} pairs set",
    expected: "Correct: {right}"
  },
  tableForm: {
    cellLabel: "{row} — {column}",
    placeholder: "Select...",
    numberPlaceholder: "Number",
    expected: "Answer key: {value}",
    rowHeader: "Item"
  },
  selectInExhibit: {
    legendMultiple: "Select every line that applies in “{title}”",
    legendSingle: "Select one line in “{title}”",
    exhibitMissing: "Exhibit not found.",
    shouldSelect: "Should be selected",
    shouldNotSelect: "Should not be selected",
    correctlySelected: "Correctly selected"
  },
  marks: {
    correct: "Correct",
    wrong: "Incorrect"
  },
  feedback: {
    title: "PBQ result",
    score: "Score: {percent}%",
    points: "{earned} of {possible} points",
    fullCredit: "Every task correct",
    partialCredit: "Partial credit",
    noCredit: "No task correct",
    taskResult: "Task {number}: {percent}%",
    taskCorrect: "Task correct",
    taskPartial: "Task partially correct",
    taskWrong: "Task incorrect",
    showSolution: "Show answer key",
    hideSolution: "Hide answer key",
    explanation: "Explanation",
    announce: "Answer recorded: {percent}% ({earned} of {possible} points)."
  },
  review: {
    title: "Your answer vs. answer key",
    noResponse: "No answer recorded for this PBQ."
  }
} as const;

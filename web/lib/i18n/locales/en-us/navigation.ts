export const navigation = {
  ariaLabel: "Main navigation",
  skipToContent: "Skip to content",
  brandTitle: "Sentinel Quiz",
  brandSubtitle: "Practice exams, guided study, and smart review for Security+, CISSP and CEH.",
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
  menu: {
    title: "Menu"
  },
  tabBar: {
    label: "Shortcuts",
    more: "More"
  },
  install: {
    action: "Install app",
    actionShort: "Install",
    hint: "Open it from your home screen, full screen.",
    done: "Got it",
    ios: {
      title: "Install on iPhone or iPad",
      intro: "Add Sentinel Quiz to your Home Screen to open it like an app:",
      steps: [
        "Tap Share in the browser toolbar.",
        "Choose “Add to Home Screen” (scroll the list if needed).",
        "Tap “Add”. The icon shows up on your home screen."
      ]
    },
    mac: {
      title: "Install on Mac",
      intro: "In Safari, add Sentinel Quiz to the Dock to open it like an app:",
      steps: [
        "Open Safari’s File menu (or click Share).",
        "Choose “Add to Dock”.",
        "Confirm with “Add”. The app opens in its own window."
      ]
    }
  },
  theme: {
    label: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System"
  },
  account: {
    label: "Account",
    guest: "Guest mode",
    guestHint: "Your progress stays on this device."
  },
  sections: {
    study: "Study",
    manage: "Account and admin"
  },
  errors: {
    sessionRefresh: "Unable to update session."
  }
} as const;

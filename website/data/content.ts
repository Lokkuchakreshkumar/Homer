export type DemoQueryKey = "terrain" | "samples" | "absent";
export type DemoFixtureKey = Exclude<DemoQueryKey, "absent">;

export interface ContentLink {
  readonly label: string;
  readonly href: string;
  readonly external?: boolean;
}

export interface FaqItem {
  readonly question: string;
  readonly answer: string;
}

export interface DemoQueryDefinition {
  readonly key: DemoQueryKey;
  readonly label: string;
  readonly text: string;
  readonly fixture: DemoFixtureKey | null;
}

export interface DemoPassage {
  readonly before: string;
  readonly emphasis: string;
  readonly after: string;
}

export interface DemoFixtureDefinition {
  readonly key: DemoFixtureKey;
  readonly passageNumber: string;
  readonly answerLabel: string;
  readonly answer: DemoPassage;
  readonly contextLabel: string;
  readonly context: string;
}

export const content = {
  site: {
    name: "Homer",
    category: "Semantic page search for your browser",
    title: "Homer: semantic page search for your browser",
    description:
      "Find the exact idea on any page, by meaning. Homer ranks the current page and highlights the strongest matching passage.",
    promise: "Find the exact idea on any page, by meaning.",
    support:
      "Ask what you need in your own words. Homer ranks the current page and highlights the strongest matching passage.",
    primaryAction: "Install Homer",
    secondaryAction: "See it in action",
    skipLink: "Skip to content",
    noscript:
      "JavaScript is off, so the local sample cannot change states. Homer still searches the current page by meaning. Read the product explanation and",
    noscriptLink: "install the current source build",
    noscriptSuffix: ".",
    socialImageAlt: "Homer semantic page search",
  },
  header: {
    homeLabel: "Homer home",
    wordmarkNote: "Page search for long reads",
    primaryNavLabel: "Primary navigation",
    mobileNavLabel: "Mobile navigation",
    mobileMenuLabel: "Menu",
    mobileOpenLabel: "Open navigation menu",
    mobileCloseLabel: "Close navigation menu",
    mobileFootnote: "Unpacked build",
    navLinks: [
      { label: "Product", href: "#product" },
      { label: "Privacy", href: "#privacy" },
      { label: "Install", href: "#install" },
      { label: "FAQ", href: "#faq" },
    ] satisfies readonly ContentLink[],
  },
  hero: {
    eyebrow: "Browser extension / semantic page search",
    note: "Use the shortcut you know. Read the passage it brings forward.",
    factsLabel: "What Homer does now",
    facts: [
      "Searches the page you are reading",
      "Uses the familiar find shortcut",
      "Shows the strongest passage first",
      "Installs from the source build",
    ],
    shortcut: {
      label: "Open Homer from the page you are reading",
      note: "The shortcut stays familiar.",
      primaryKey: "Ctrl",
      secondaryKey: "F",
      ariaLabel: "Homer browser shortcut",
      keysLabel: "Control plus F, or Command plus F on macOS",
    },
  },
  chapters: {
    comparisonLabel: "The same page, two ways to search",
    comparisonSignal: "Meaning leads",
    findLabel: "Exact terms",
    questionLabel: "Question",
    resultLabel: "Passage in view",
  },
  problem: {
    label: "When the words do not match",
    title: "The page may use different words.",
    displayTitle: "The answer can be there, under other words.",
    body:
      "Find looks for strings you already know. When the page explains an idea in different language, the useful sentence can stay out of view.",
    exactLabel: "Find in page",
    exactTitle: "rover + hazard + no-go",
    exactBody:
      "Useful when you know the terms. Less useful when the page says \"exclude this cell from the route.\"",
    meaningLabel: "Homer",
    meaningTitle: "How does the rover avoid unsafe terrain?",
    meaningBody: "Homer ranks the page against your question and brings the matching passage into view.",
    actionLabel: "See the difference",
  },
  reader: {
    label: "For long reads",
    title: "You often know what you need before you know the wording.",
    body:
      "Homer is a browser extension for technical pages, research notes, and the sentence you almost passed. Ask a question in your own words and see the passage that answers it.",
    note: "Homer runs in the page you already have open.",
  },
  demo: {
    label: "Try the sample",
    title: "Ask the page a question.",
    body:
      "Choose one of the questions below. The local rover manual shows the intended result order without making a live search.",
    boundary:
      "This is a local sample. It uses the approved questions below. Nothing here calls a proxy or a model.",
    pageTitle: "Autonomous traversal on dry-world survey routes",
    pageMeta: "Operations manual / revision 4.2",
    intro:
      "Each morning, the route board marks the basin as reachable, caution, or excluded. Dust movement changes the terrain model, and the surface images are refreshed.",
    queries: [
      { key: "terrain", label: "Unsafe terrain", text: "How does the rover avoid unsafe terrain?", fixture: "terrain" },
      { key: "samples", label: "Sample storage", text: "Where are collected samples stored?", fixture: "samples" },
      { key: "absent", label: "No answer", text: "Who won the design award?", fixture: null },
    ] satisfies readonly DemoQueryDefinition[],
    fixtures: [
      {
        key: "terrain",
        passageNumber: "04",
        answerLabel: "04 / strongest passage",
        answer: {
          before: "Stereo vision builds a fresh terrain mesh. The planner marks ",
          emphasis: "steep slopes, loose regolith, and radiation-exposed ground as no-go zones",
          after: ", then requests a safer path whenever confidence drops.",
        },
        contextLabel: "Related route detail",
        context: "Nominal traverse rate: 18 m/hr on marked routes. Caution terrain defaults to 6 m/hr.",
      },
      {
        key: "samples",
        passageNumber: "07",
        answerLabel: "07 / strongest passage",
        answer: {
          before: "Collected cores move into the rover's sealed sample carousel. Each tube receives a ",
          emphasis: "habitat ID, depth log, and image hash",
          after: " before entering the return cache.",
        },
        contextLabel: "Return cache",
        context: "The carousel holds 12 tubes. Mission control receives transfer status, not sample contents.",
      },
    ] satisfies readonly DemoFixtureDefinition[],
    labels: {
      localSample: "Local sample",
      windowTitle: "Illustrative demo",
      noLiveRequest: "No live request",
      inputLabel: "Question for this local sample",
      suggestedQuery: "Try this question",
      findAction: "Find",
      approvedQueries: "Sample questions",
      exploreResult: "Result controls",
      showContext: "Show context",
      replay: "Replay",
      reset: "Reset",
      documentLabel: "Rover manual excerpt, local sample",
      controlsLabel: "Local demo controls",
      documentTail: "The route board records the decision before the next traverse window opens.",
      illustrativeData: "Sample data",
      fieldSample: "Field sample / page 08",
      currentPageExcerpt: "Local page excerpt",
      promptWhenEmpty: "Choose a question to reveal a result",
      noAnswerTitle: "No useful match here.",
      noAnswerBody: "The passage stays unhighlighted. A weak match is not promoted.",
    },
    validation: {
      emptyQuery: "Enter a question before searching.",
      unsupportedQuery: "Use one of the three approved sample questions.",
    },
    status: {
      idle: "Ready for a question",
      validation: "Enter a question",
      unsupported: "Choose a sample question",
      reset: "Sample cleared",
      absent: "No useful match on this page",
      replayAbsent: "Replaying with no useful match",
      context: "Answer with context",
      answered: "Strongest passage",
      replayAnswer: "Replaying the strongest passage",
      replayContext: "Replaying answer and context",
      relatedPassage: " and one related passage",
    },
  },
  heroFrame: {
    topLabel: "Local page excerpt",
    signalLabel: "Strongest passage in view",
    kicker: "Field manual / page 08",
    title: "Autonomous traversal on dry-world survey routes",
    copy: "Each morning the route board divides the basin into reachable, caution, and excluded cells. Surface images refresh whenever dust movement changes the terrain model.",
    query: "How does the rover avoid unsafe terrain?",
    answerLabel: "04 / strongest passage",
    footerLabels: ["Page excerpt", "Question in view"],
  },
  heroWindow: {
    ariaLabel: "Illustration of Homer bringing a passage into view",
    address: "reader.homer.page",
    menuLabel: "Menu",
    sidebarLabel: "Page outline",
    sidebarRecentLabel: "Recent questions",
    sidebarOutlineItems: ["Route board", "Terrain mesh", "Sample carousel", "Return cache"],
    sidebarNoMatch: "No match",
    searchLabel: "Search the page",
    currentPageLabel: "Current page",
    contextLabel: "Related context",
    sidebarNote: "No live request",
    toolbarLabel: "Local page excerpt",
    pageMeta: "Field manual / page 08",
    footerLabel: "Page excerpt",
    promptLabel: "Question in view",
  },
  product: {
    title: "A question leads to a passage.",
    body: "Homer puts the strongest matching passage first. Related text stays available as context. A weak match is left unmarked.",
    footnote:
      "This excerpt, its prose, passage numbers, and query mapping were written for the site. The interaction shows the intended result hierarchy without making a live request.",
  },
  how: {
    label: "After the shortcut",
    title: "Homer ranks the page you are reading.",
    body:
      "The extension sends a question and extracted page text to its configured ranking proxy. It returns a strongest passage, then related context. The website sample does not make that request.",
    linkLabel: "See the browser boundary",
    panelLabel: "The extension flow",
    panelNote: "The page stays in view",
    steps: [
      {
        number: "01",
        title: "Open the page",
        body: "Read a web page. Press Ctrl+F on Windows or Linux, or Cmd+F on macOS, to open Homer.",
      },
      {
        number: "02",
        title: "Ask your question",
        body: "Type what you need in your own words. Homer compares the question with text from the current page.",
      },
      {
        number: "03",
        title: "Read the result",
        body: "The strongest passage comes first. Enter moves to the next match, Shift+Enter moves back, and Esc closes the bar.",
      },
    ],
  },
  privacy: {
    label: "Current data flow",
    title: "Know what crosses the browser boundary.",
    body:
      "A live Homer search sends the page URL, your trimmed query, and extracted visible text blocks to the configured ranking proxy. The URL can include a query string or fragment.",
    flowLabel: "Current extension request",
    boundaryTitle: "What the extension sends",
    requestHeading: "What the request contains",
    conditional:
      "When a real judge is selected, a TypeSafe key is configured, and stub mode is not selected, the proxy sends the retained state to TypeSafe.",
    unknown:
      "The repository does not establish complete hosting or provider retention behavior. The proxy keeps bounded process-local cache entries and writes error logs. Deployment settings determine the surrounding hosting behavior.",
    demoBoundary:
      "The demo on this page uses local sample content. It does not call the ranking proxy. A future live search adapter would need its own review.",
    bullets: [
      "The request includes the page URL, query, and extracted visible text blocks.",
      "Visible page text can contain sensitive information.",
      "The semantic search path does not use the dormant ad-scan host setting as its boundary.",
    ],
    searchBoundaryLabel: "Website demo:",
    detailLabel: "What is known",
    requestLabel: "Request contents",
    linkLabel: "Continue to installation",
    flow: {
      inputLabel: "Page and question",
      inputBody: "Page URL, trimmed query, and visible text blocks",
      proxyLabel: "Configured ranking proxy",
      proxyBody: "The live extension search uses this service.",
      outputLabel: "Ranked passage",
      outputBody: "The strongest passage comes first. Related text follows.",
    },
    sideNote: "This website does not use that extension path for the sample.",
  },
  install: {
    label: "Current installation",
    title: "Load the current build unpacked.",
    body:
      "The repository documents a source installation for Chromium-based browsers. This site does not provide an automatic install or a store link.",
    sourceLabel: "Unpacked source build",
    tip: "The current build is in the repository at extension/dist.",
    steps: [
      "Clone the public Homer repository.",
      "Open the browser's extension-management page, such as chrome://extensions.",
      "Enable Developer mode, then choose Load unpacked.",
      "Select the extension/dist directory and pin Homer.",
    ],
    browserTitle: "Browsers named in the docs",
    browserBody:
      "The root README names Chrome, Brave, and Edge. The extension README also names Arc. The manifest declares minimum_chrome_version 120. No cross-browser test matrix has been run.",
    mobileTitle: "If you are on a phone",
    mobile:
      "No mobile install path is verified. Use the source instructions on a desktop browser, or come back when a mobile path is documented.",
    linksLabel: "Homer documentation",
    links: [
      { label: "Quick install", href: "https://github.com/Lokkuchakrushkumar/Homer#quick-install" },
      { label: "Usage guide", href: "https://github.com/Lokkuchakrushkumar/Homer#usage" },
      { label: "Extension README", href: "https://github.com/Lokkuchakrushkumar/Homer/blob/master/extension/README.md" },
      { label: "Repository source", href: "https://github.com/Lokkuchakrushkumar/Homer" },
    ] satisfies readonly ContentLink[],
  },
  faq: {
    label: "Before you install",
    title: "The practical details.",
    intro: "The boundaries that matter before you load the extension.",
    linkLabel: "Return to the sample",
    items: [
      {
        question: "What does \"by meaning\" mean?",
        answer:
          "Homer compares your question with passages on the current page. You do not need to reproduce the page's exact wording.",
      },
      {
        question: "Which browsers are documented?",
        answer:
          "The current documentation names Chromium-based Chrome, Brave, Edge, and Arc. The manifest declares Chrome 120 or newer. No cross-browser test matrix has been run.",
      },
      {
        question: "How is Homer installed today?",
        answer:
          "The documented path is the public repository plus the checked-in extension/dist build loaded as an unpacked extension. This page does not offer automatic installation.",
      },
      {
        question: "Why does the extension use a proxy?",
        answer:
          "The current semantic flow uses the configured ranking proxy to run AI ranking without putting the model API key in the extension. A live search needs a reachable configured service.",
      },
      {
        question: "What does this website demo send?",
        answer: "It uses local sample content only. It does not call the ranking proxy, a model, or a search API.",
      },
      {
        question: "What happens when the service is unavailable?",
        answer:
          "A live semantic search cannot complete without a reachable configured ranking service. The current free-service configuration can sleep after inactivity, take time to wake, or restart. Homer reports the failure instead of inventing a result.",
      },
      {
        question: "Can I install on mobile?",
        answer:
          "No mobile install path is verified. Use the source instructions on a desktop browser rather than a store or automatic install button.",
      },
    ] satisfies readonly FaqItem[],
  },
  closing: {
    label: "Current source build",
    title: "Ask the page what you need.",
    body: "Load the current Homer build, open a page you are reading, and ask a question in your own words.",
    note: "The sample above is local. This page makes no live search request.",
    documentation: {
      label: "Read the usage guide",
      href: "https://github.com/Lokkuchakrushkumar/Homer#usage",
    } satisfies ContentLink,
  },
  footer: {
    status: "Homer / current source build",
    navLabel: "Footer links",
    backToTop: "Back to top",
    links: [
      { label: "Repository", href: "https://github.com/Lokkuchakrushkumar/Homer" },
      { label: "Quick install", href: "https://github.com/Lokkuchakrushkumar/Homer#quick-install" },
      { label: "Usage", href: "https://github.com/Lokkuchakrushkumar/Homer#usage" },
      { label: "Extension README", href: "https://github.com/Lokkuchakrushkumar/Homer/blob/master/extension/README.md" },
    ] satisfies readonly ContentLink[],
  },
  searchBoundary: {
    mode: "illustrative-local",
    description: "Future live search belongs behind a separately reviewed server-side adapter. No adapter is included in this release.",
  },
} as const;

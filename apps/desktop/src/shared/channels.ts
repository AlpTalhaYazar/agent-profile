export const CHANNELS = {
  system: {
    version: "system.version",
    defaultCwd: "system.defaultCwd",
    pickDirectory: "system.pickDirectory",
    bootstrap: "system.bootstrap",
  },
  setup: {
    markComplete: "setup.markComplete",
  },
  auth: {
    list: "auth.list",
    add: "auth.add",
    setSecret: "auth.setSecret",
    rotate: "auth.rotate",
    remove: "auth.remove",
    updateMeta: "auth.updateMeta",
  },
  oauth: {
    start: "auth.oauth.start",
    refresh: "auth.oauth.refresh",
    detect: "auth.oauth.detect",
    adopt: "auth.oauth.adopt",
  },
  profile: {
    list: "profile.list",
    show: "profile.show",
    validate: "profile.validate",
    preview: "profile.preview",
    save: "profile.save",
    createScope: "profile.createScope",
  },
  persona: {
    render: "persona.render",
  },
  skills: {
    search: "skills.search",
    detail: "skills.detail",
    audit: "skills.audit",
    listInstalled: "skills.listInstalled",
    install: "skills.install",
  },
  sessions: {
    list: "sessions.list",
    kill: "sessions.kill",
    relaunch: "sessions.relaunch",
    drift: "sessions.drift",
    launch: "sessions.launch",
    resumeNative: "sessions.resumeNative",
    openTerminal: "sessions.openTerminal",
    writeTerminal: "sessions.writeTerminal",
    resizeTerminal: "sessions.resizeTerminal",
    closeTerminal: "sessions.closeTerminal",
  },
} as const;

export const SESSION_EVENT_CHANNEL = "myclaude.sessions.event";
export const SESSION_TERMINAL_EVENT_CHANNEL = "myclaude.sessions.terminal";

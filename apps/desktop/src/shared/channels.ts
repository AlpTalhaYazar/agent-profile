export const CHANNELS = {
  system: {
    version: "system.version",
    defaultCwd: "system.defaultCwd",
    pickDirectory: "system.pickDirectory",
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
  },
  persona: {
    render: "persona.render",
  },
  sessions: {
    list: "sessions.list",
    kill: "sessions.kill",
    relaunch: "sessions.relaunch",
    drift: "sessions.drift",
  },
} as const;

export const SESSION_EVENT_CHANNEL = "myclaude.sessions.event";

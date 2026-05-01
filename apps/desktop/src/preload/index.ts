/**
 * @module preload
 *
 * Renderer <-> Main bridge.
 *
 * The preload runs in an isolated context and exposes a narrow, typed surface
 * to the Renderer via `contextBridge.exposeInMainWorld`.
 */
import { contextBridge, ipcRenderer } from "electron";
import type { MyClaudeBridge, SessionUpdatePayload } from "../shared/bridge.js";
import { CHANNELS, SESSION_EVENT_CHANNEL } from "../shared/channels.js";

const bridge: MyClaudeBridge = {
  system: {
    version: (): Promise<string> => ipcRenderer.invoke(CHANNELS.system.version),
    defaultCwd: (): Promise<string> => ipcRenderer.invoke(CHANNELS.system.defaultCwd),
    pickDirectory: (): Promise<string | null> => ipcRenderer.invoke(CHANNELS.system.pickDirectory),
  },
  auth: {
    list: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.list),
    add: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.add, opts),
    setSecret: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.setSecret, opts),
    rotate: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.rotate, opts),
    remove: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.remove, opts),
    updateMeta: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.auth.updateMeta, opts),
  },
  oauth: {
    start: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.oauth.start, opts),
    refresh: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.oauth.refresh, opts),
    detect: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.oauth.detect),
    adopt: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.oauth.adopt, opts),
  },
  profile: {
    list: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.profile.list, opts),
    show: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.profile.show, opts),
    validate: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.profile.validate, opts),
    preview: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.profile.preview, opts),
    save: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.profile.save, opts),
  },
  persona: {
    render: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.persona.render, opts),
  },
  sessions: {
    list: (): Promise<unknown> => ipcRenderer.invoke(CHANNELS.sessions.list),
    kill: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.sessions.kill, opts),
    relaunch: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.sessions.relaunch, opts),
    drift: (opts): Promise<unknown> => ipcRenderer.invoke(CHANNELS.sessions.drift, opts),
    onUpdate: (cb): (() => void) => {
      const listener = (_e: unknown, payload: unknown): void => cb(payload as SessionUpdatePayload);
      ipcRenderer.on(SESSION_EVENT_CHANNEL, listener);
      return () => {
        ipcRenderer.off(SESSION_EVENT_CHANNEL, listener);
      };
    },
  },
};

contextBridge.exposeInMainWorld("myclaude", bridge);

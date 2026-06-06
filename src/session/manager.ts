// src/session/manager.ts - Session management

import type { Session, AgentMode, Message } from '../api/types.js';
import { SessionStore } from './store.js';

export class SessionManager {
  private store: SessionStore;
  private currentSession: Session | null = null;

  constructor() {
    this.store = new SessionStore();
  }

  createSession(name: string, model: string, mode: AgentMode): Session {
    this.currentSession = this.store.createSession(name, model, mode);
    return this.currentSession;
  }

  resumeSession(sessionId: string): Session | null {
    const session = this.store.getSession(sessionId);
    if (session) {
      this.currentSession = session;
    }
    return session;
  }

  forkSession(sessionId: string, newName: string): Session | null {
    const forked = this.store.forkSession(sessionId, newName);
    if (forked) {
      this.currentSession = forked;
    }
    return forked;
  }

  addMessage(message: Message): void {
    if (!this.currentSession) return;
    this.store.addMessage(this.currentSession.id, message);
    this.currentSession.messages.push(message);
  }

  getMessages(): Message[] {
    return this.currentSession?.messages || [];
  }

  listSessions(limit?: number): Session[] {
    return this.store.listSessions(limit);
  }

  deleteSession(sessionId: string): void {
    this.store.deleteSession(sessionId);
    if (this.currentSession?.id === sessionId) {
      this.currentSession = null;
    }
  }

  renameSession(name: string): void {
    if (!this.currentSession) return;
    this.store.renameSession(this.currentSession.id, name);
    this.currentSession.name = name;
  }

  get current(): Session | null {
    return this.currentSession;
  }

  clearCurrentSession(): void {
    this.currentSession = null;
  }

  close(): void {
    this.store.close();
  }
}

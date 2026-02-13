#!/usr/bin/env bun
/**
 * TodoEnforcement.ts - Stop Handler for Todo Enforcement
 *
 * This module is called by StopOrchestrator to handle todo state saving
 * and intelligent detection of incomplete work.
 *
 * INPUT (from StopOrchestrator):
 * - parsed: Parsed transcript object
 * - hookInput: Raw hook input from Claude Code
 *
 * SIDE EFFECTS:
 * - Writes to ~/.claude/MEMORY/STATE/todo-state.json
 * - Sends voice notification
 * - Updates tab title
 *
 * Returns: Promise<void>
 */

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

interface Todo {
  content: string;
  status: string;
  priority: string;
  id: string;
}

interface TodoState {
  session_id: string;
  timestamp: string;
  incomplete_todos: Todo[];
  total_todos: number;
  completed_count: number;
  cwd: string;
  suspicious: boolean;
  reason?: string;
}

interface ParsedTranscript {
  plainCompletion: string;
  messages: any[];
}

const STATE_DIR = `${process.env.HOME}/.claude/MEMORY/STATE`;
const STATE_FILE = join(STATE_DIR, 'todo-state.json');
const VOICE_SERVER_URL = 'http://localhost:8888/notify';

/**
 * Extract last TodoWrite call from parsed messages
 */
function getLastTodoWrite(messages: any[]): Todo[] | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'tool_use' && msg.tool_name === 'TodoWrite') {
      return msg.tool_input?.todos || null;
    }
  }
  return null;
}

/**
 * Check if assistant is claiming completion
 */
function isClaimingCompletion(parsed: ParsedTranscript): boolean {
  if (!parsed.plainCompletion) return false;

  const text = parsed.plainCompletion.toLowerCase();
  const completionPatterns = [
    /完成|搞定|好了|可以了/,
    /done|finished|complete|ready/i
  ];

  return completionPatterns.some(pattern => pattern.test(text));
}

/**
 * Detect actual work by checking tool usage
 */
function hasActualWork(messages: any[]): boolean {
  const recentMessages = messages.slice(-20);
  const toolUses = recentMessages.filter(msg =>
    msg.type === 'tool_use' && msg.tool_name !== 'TodoWrite'
  );

  return toolUses.length > 0;
}

/**
 * Extract incomplete todos
 */
function getIncompleteTodos(todos: Todo[]): Todo[] {
  if (!todos || todos.length === 0) return [];
  return todos.filter(todo =>
    todo.status !== 'completed' && todo.status !== 'cancelled'
  );
}

/**
 * Save state to disk
 */
function saveState(state: TodoState): void {
  try {
    if (!existsSync(STATE_DIR)) {
      execSync(`mkdir -p "${STATE_DIR}"`, { stdio: 'ignore' });
    }
    writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    console.error(`[TodoEnforcement] State saved: ${state.incomplete_todos.length}/${state.total_todos} incomplete`);
  } catch (error) {
    console.error(`[TodoEnforcement] Failed to save state:`, error);
  }
}

/**
 * Send voice notification
 */
function sendVoiceNotification(count: number): void {
  const payload = {
    message: `还有 ${count} 个任务未完成`,
    title: '任务提醒',
    voice_enabled: true,
  };

  fetch(VOICE_SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(500),
    body: JSON.stringify(payload),
  }).catch(() => {
    // Silent fail
  });
}

/**
 * Update tab title with pending count
 */
function updateTabTitle(count: number): void {
  try {
    const isKitty = process.env.TERM === 'xterm-kitty' || process.env.KITTY_LISTEN_ON;
    if (isKitty) {
      execSync(`kitty @ set-tab-title "待恢复: ${count} 个任务"`, {
        stdio: 'ignore',
        timeout: 2000,
      });
    }
  } catch {
    // Silent fail
  }
}

/**
 * Main handler function
 */
export async function handleTodoEnforcement(
  parsed: ParsedTranscript,
  hookInput: { session_id: string }
): Promise<void> {
  const { session_id } = hookInput;

  // Extract todos from transcript
  const todos = getLastTodoWrite(parsed.messages);

  if (!todos) {
    console.error('[TodoEnforcement] No TodoWrite found in transcript');
    return;
  }

  const incomplete = getIncompleteTodos(todos);
  const completed = todos.length - incomplete.length;

  // If all complete, clean state and exit
  if (incomplete.length === 0) {
    console.error('[TodoEnforcement] All todos complete, cleaning state');
    try {
      if (existsSync(STATE_FILE)) {
        execSync(`rm "${STATE_FILE}"`, { stdio: 'ignore' });
      }
    } catch {
      // Ignore cleanup errors
    }
    return;
  }

  // Intelligent detection: check for fake completion
  const claimingComplete = isClaimingCompletion(parsed);
  const hasWork = hasActualWork(parsed.messages);
  let suspicious = false;
  let reason: string | undefined;

  if (claimingComplete && incomplete.length > 0) {
    if (!hasWork) {
      // High suspicious: claims done but no actual work
      suspicious = true;
      reason = '宣称完成但没有实际工作';
    } else {
      // Medium suspicious: claims done but has incomplete
      suspicious = true;
      reason = '宣称完成但有未完成任务';
    }
  }

  // Save state
  const state: TodoState = {
    session_id,
    timestamp: new Date().toISOString(),
    incomplete_todos: incomplete,
    total_todos: todos.length,
    completed_count: completed,
    cwd: process.cwd(),
    suspicious,
    reason,
  };

  saveState(state);

  // Voice notification
  sendVoiceNotification(incomplete.length);

  // Update tab title
  updateTabTitle(incomplete.length);

  // Log suspicious detection
  if (suspicious) {
    console.error(`[TodoEnforcement] ⚠️ Suspicious completion detected: ${reason}`);
    console.error(`[TodoEnforcement] Incomplete: ${incomplete.length}/${todos.length}`);
  }
}

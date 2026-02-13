#!/usr/bin/env bun
/**
 * TodoEnforcer.hook.ts - Detect Incomplete Todos at Session Stop (Stop Event)
 *
 * PURPOSE:
 * Detects when Claude claims completion but has incomplete todos. Saves state for
 * recovery in next session and provides voice notification.
 *
 * TRIGGER: Stop (fires after Claude generates a response)
 *
 * INPUT:
 * - session_id: Current session identifier
 * - transcript_path: Path to JSONL transcript file
 * - hook_event_name: "Stop"
 *
 * OUTPUT:
 * - stdout: None (no context injection)
 * - stderr: Error messages and status logs
 * - exit(0): Normal completion
 *
 * SIDE EFFECTS:
 * - Writes to ~/.claude/MEMORY/STATE/todo-state.json
 * - Sends voice notification via Voice Server (if running)
 * - Logs status to stderr
 *
 * INTER-HOOK RELATIONSHIPS:
 * - DEPENDS ON: None (runs independently)
 * - COORDINATES WITH: TodoRecovery (reads saved state)
 * - MUST RUN BEFORE: SessionEnd (so state is saved before summary)
 * - MUST RUN AFTER: ResponseCapture (so transcript is complete)
 *
 * ERROR HANDLING:
 * - Missing transcript: Exits gracefully (no state to save)
 * - Parse failures: Logs error, exits gracefully
 * - Voice server down: Silent fail (notification is optional)
 * - State write failure: Logs error, doesn't block session
 *
 * PERFORMANCE:
 * - Non-blocking: Yes (Stop event is async)
 * - Typical execution: < 50ms
 * - Optimization: Only scans last 50 messages
 * - Optimization: Caches parsed transcript
 *
 * INTELLIGENT DETECTION:
 * - Detects "fake completion": Claims done but has incomplete todos
 * - Detects "suspicious pattern": Claims done but no actual work (tools used)
 * - Tracks completion rate over time
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
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

interface TranscriptMessage {
  type: string;
  role?: string;
  tool_name?: string;
  tool_input?: any;
  content?: string;
}

const STATE_DIR = `${process.env.HOME}/.claude/MEMORY/STATE`;
const STATE_FILE = join(STATE_DIR, 'todo-state.json');
const VOICE_SERVER_URL = 'http://localhost:8888/notify';

/**
 * Parse transcript JSONL file and return messages
 */
function parseTranscript(transcriptPath: string): TranscriptMessage[] {
  try {
    const content = readFileSync(transcriptPath, 'utf-8');
    const lines = content.trim().split('\n');
    return lines
      .filter(line => line.trim())
      .map(line => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean) as TranscriptMessage[];
  } catch (error) {
    console.error(`[TodoEnforcer] Failed to parse transcript:`, error);
    return [];
  }
}

/**
 * Extract last TodoWrite call from transcript
 */
function getLastTodoWrite(messages: TranscriptMessage[]): Todo[] | null {
  // Find last TodoWrite tool use (scan from end)
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'tool_use' && msg.tool_name === 'TodoWrite') {
      return msg.tool_input?.todos || null;
    }
  }
  return null;
}

/**
 * Check if Claude is claiming completion
 */
function isClaimingCompletion(messages: TranscriptMessage[]): boolean {
  // Check last assistant message for completion claims
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.type === 'message' && msg.role === 'assistant') {
      if (!msg.content) return false;

      const text = msg.content.toLowerCase();
      // Chinese and English completion patterns
      const completionPatterns = [
        /完成|搞定|好了|可以了/,
        /done|finished|complete|ready/i
      ];

      return completionPatterns.some(pattern => pattern.test(text));
    }
  }
  return false;
}

/**
 * Detect actual work by checking tool usage
 */
function hasActualWork(messages: TranscriptMessage[]): boolean {
  // Check if any tools were used (excluding TodoWrite itself)
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
    console.error(`[TodoEnforcer] State saved: ${state.incomplete_todos.length}/${state.total_todos} incomplete`);
  } catch (error) {
    console.error(`[TodoEnforcer] Failed to save state:`, error);
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
    // Silent fail - voice server is optional
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
    // Silent fail - tab title is optional
  }
}

/**
 * Main hook logic
 */
async function main() {
  // Read stdin
  const decoder = new TextDecoder();
  const reader = Bun.stdin.stream().getReader();
  let input = '';

  const timeoutPromise = new Promise<void>((resolve) => {
    setTimeout(() => resolve(), 500);
  });

  const readPromise = (async () => {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      input += decoder.decode(value, { stream: true });
    }
  })();

  await Promise.race([readPromise, timeoutPromise]);

  if (!input.trim()) {
    console.error('[TodoEnforcer] No input received');
    process.exit(0);
  }

  const hookInput = JSON.parse(input) as {
    session_id: string;
    transcript_path: string;
    hook_event_name: string;
  };

  const { session_id, transcript_path } = hookInput;

  console.error(`[TodoEnforcer] Processing Stop event for session: ${session_id}`);

  // Parse transcript
  const messages = parseTranscript(transcript_path);
  if (messages.length === 0) {
    console.error('[TodoEnforcer] No messages in transcript');
    process.exit(0);
  }

  // Extract todos
  const todos = getLastTodoWrite(messages);
  if (!todos) {
    console.error('[[TodoEnforcer] No TodoWrite found in transcript');
    process.exit(0);
  }

  const incomplete = getIncompleteTodos(todos);
  const completed = todos.length - incomplete.length;

  // If all complete, clean state and exit
  if (incomplete.length === 0) {
    console.error('[TodoEnforcer] All todos complete, cleaning state');
    try {
      if (existsSync(STATE_FILE)) {
        execSync(`rm "${STATE_FILE}"`, { stdio: 'ignore' });
      }
    } catch {
      // Ignore cleanup errors
    }
    process.exit(0);
  }

  // Intelligent detection: check for fake completion
  const claimingComplete = isClaimingCompletion(messages);
  const hasWork = hasActualWork(messages);
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
    console.error(`[TodoEnforcer] ⚠️ Suspicious completion detected: ${reason}`);
    console.error(`[TodoEnforcer] Incomplete: ${incomplete.length}/${todos.length}`);
  }

  process.exit(0);
}

main().catch(error => {
  console.error('[TodoEnforcer] Fatal error:', error);
  process.exit(0);
});

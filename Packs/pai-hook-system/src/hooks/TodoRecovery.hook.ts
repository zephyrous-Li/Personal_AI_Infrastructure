#!/usr/bin/env bun
/**
 * TodoRecovery.hook.ts - Recover Incomplete Todos at Session Start (SessionStart Event)
 *
 * PURPOSE:
 * Detects saved incomplete todo state from previous session and injects
 * recovery prompt to help user continue work.
 *
 * TRIGGER: SessionStart (fires when new session begins)
 *
 * INPUT:
 * - session_id: Current session identifier
 * - transcript_path: Path to JSONL transcript file
 * - hook_event_name: "SessionStart"
 *
 * OUTPUT:
 * - stdout: Recovery prompt (injected into Claude context)
 * - stderr: Status logs
 * - exit(0): Normal completion
 *
 * SIDE EFFECTS:
 * - Reads from ~/.claude/MEMORY/STATE/todo-state.json
 * - Cleans up expired state (> 24 hours)
 * - Updates tab title (yellow = has pending tasks)
 * - Sends voice notification
 *
 * INTER-HOOK RELATIONSHIPS:
 * - DEPENDS ON: TodoEnforcer (expects saved state)
 * - COORDINATES WITH: StartupGreeting (runs after banner)
 * - MUST RUN BEFORE: None (context injection happens early)
 * - MUST RUN AFTER: StartupGreeting (so user sees banner first)
 *
 * ERROR HANDLING:
 * - Missing state file: Exits gracefully (no recovery needed)
 * - Expired state: Cleans up, exits gracefully
 * - Malformed state: Logs error, cleans up
 *
 * PERFORMANCE:
 * - Blocking: Yes (stdout is injected into context)
 * - Typical execution: < 20ms
 * - Optimization: Only reads small JSON file
 *
 * USER EXPERIENCE:
 * - Non-intrusive: Only shows if there are incomplete todos
 * - Clear action: User knows what to do (continue or new)
 * - Visual feedback: Yellow tab + title count
 * - Audio feedback: Voice announcement
 */

import { readFileSync, unlinkSync, existsSync } from 'fs';
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
  suspicious?: boolean;
  reason?: string;
}

const STATE_DIR = `${process.env.HOME}/.claude/MEMORY/STATE`;
const STATE_FILE = join(STATE_DIR, 'todo-state.json');
const VOICE_SERVER_URL = 'http://localhost:8888/notify';
const STATE_EXPIRY_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Load state from disk
 */
function loadState(): TodoState | null {
  try {
    if (!existsSync(STATE_FILE)) {
      return null;
    }

    const content = readFileSync(STATE_FILE, 'utf-8');
    return JSON.parse(content) as TodoState;
  } catch (error) {
    console.error(`[TodoRecovery] Failed to load state:`, error);
    return null;
  }
}

/**
 * Check if state is expired
 */
function isExpired(state: TodoState): boolean {
  const timestamp = new Date(state.timestamp).getTime();
  const now = Date.now();
  const age = now - timestamp;
  return age > STATE_EXPIRY_MS;
}

/**
 * Format todo list for display
 */
function formatTodoList(todos: Todo[]): string {
  return todos.map(todo => {
    const status = todo.status === 'in_progress' ? '⏳' : '⬜';
    const priority = todo.priority === 'high' ? '🔴' :
                   todo.priority === 'medium' ? '🟡' : '🟢';
    return `  ${status} ${priority} ${todo.content}`;
  }).join('\n');
}

/**
 * Generate recovery prompt
 */
function generateRecoveryPrompt(state: TodoState): string {
  const incomplete = state.incomplete_todos;
  const total = state.total_todos;
  const completed = state.completed_count;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  let prompt = `⚠️ 检测到上次会话有未完成任务\n\n`;
  prompt += `上次会话: ${new Date(state.timestamp).toLocaleString('zh-CN')}\n`;
  prompt += `进度: ${completed}/${total} (${percentage}%)\n\n`;
  prompt += `未完成任务:\n${formatTodoList(incomplete)}\n\n`;

  if (state.suspicious && state.reason) {
    prompt += `⚠️ ${state.reason}\n\n`;
  }

  prompt += `💡 提示:\n`;
  prompt += `- 继续完成未完成任务\n`;
  prompt += `- 完成后使用 TodoWrite 标记为 completed\n`;
  prompt += `- 不要假装完成，确保所有任务都完成\n\n`;

  prompt += `📍 工作目录: ${state.cwd}\n`;

  return prompt;
}

/**
 * Clean up state file
 */
function cleanupState(): void {
  try {
    if (existsSync(STATE_FILE)) {
      unlinkSync(STATE_FILE);
      console.error('[TodoRecovery] State cleaned up');
    }
  } catch (error) {
    console.error(`[TodoRecovery] Cleanup error:`, error);
  }
}

/**
 * Send voice notification
 */
function sendVoiceNotification(count: number): void {
  const payload = {
    message: `检测到 ${count} 个未完成任务`,
    title: '任务恢复',
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
 * Update tab title to indicate pending tasks
 */
function updateTabTitle(count: number): void {
  try {
    const isKitty = process.env.TERM === 'xterm-kitty' || process.env.KITTY_LISTEN_ON;
    if (isKitty) {
      // Set yellow background for pending tasks
      execSync('kitty @ set-tab-title "待恢复: ' + count + ' 个任务"', {
        stdio: 'ignore',
        timeout: 2000,
      });
      execSync('kitty @ set-tab-color title yellow', {
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
    console.error('[TodoRecovery] No input received');
    process.exit(0);
  }

  const hookInput = JSON.parse(input) as {
    session_id: string;
    transcript_path: string;
    hook_event_name: string;
  };

  const { session_id } = hookInput;

  console.error(`[TodoRecovery] Processing SessionStart for: ${session_id}`);

  // Load state
  const state = loadState();

  if (!state) {
    console.error('[TodoRecovery] No saved state found');
    process.exit(0);
  }

  // Check expiry
  if (isExpired(state)) {
    console.error(`[TodoRecovery] State expired (>24h), cleaning up`);
    cleanupState();
    process.exit(0);
  }

  console.error(`[TodoRecovery] Found ${state.incomplete_todos.length} incomplete todos`);

  // Send notifications
  sendVoiceNotification(state.incomplete_todos.length);
  updateTabTitle(state.incomplete_todos.length);

  // Generate and inject recovery prompt
  const prompt = generateRecoveryPrompt(state);
  console.log(prompt);

  // Clean up state after injection (one-time recovery)
  cleanupState();

  console.error('[TodoRecovery] Recovery prompt injected');

  process.exit(0);
}

main().catch(error => {
  console.error('[TodoRecovery] Fatal error:', error);
  process.exit(0);
});

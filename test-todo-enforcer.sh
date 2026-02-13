#!/bin/bash
#
# Test script for TodoEnforcer + TodoRecovery Hooks
#
# This script tests the Phase 1 implementation:
# 1. TodoEnforcer (Stop event)
# 2. TodoRecovery (SessionStart event)
#

set -e

echo "🧪 Testing Todo Enforcer Hooks"
echo "================================"
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test 1: Test TodoEnforcer with incomplete todos
echo -e "${YELLOW}Test 1: TodoEnforcer with incomplete todos${NC}"
echo "-------------------------------------------"

# Create a mock transcript with incomplete todos
MOCK_TRANSCRIPT="/tmp/todo-test-transcript.jsonl"
cat > "$MOCK_TRANSCRIPT" << 'EOF'
{"type":"message","role":"user","content":"帮我实现用户认证"}
{"type":"tool_use","tool_name":"TodoWrite","tool_input":{"todos":[{"id":"1","content":"实现登录","status":"in_progress","priority":"high"},{"id":"2","content":"编写测试","status":"pending","priority":"medium"}]}}
{"type":"message","role":"assistant","content":"好的，开始实现"}
{"type":"tool_use","tool_name":"Bash","tool_input":{"command":"echo 'implementing login'"}}
{"type":"message","role":"assistant","content":"完成了！"}
EOF

# Test Stop event
STOP_INPUT=$(cat << EOF
{
  "session_id": "test-session-123",
  "transcript_path": "$MOCK_TRANSCRIPT",
  "hook_event_name": "Stop"
}
EOF
)

echo "$STOP_INPUT" | bun ~/.claude/hooks/TodoEnforcer.hook.ts 2>&1 | head -20

# Check if state was saved
if [ -f "$HOME/.claude/MEMORY/STATE/todo-state.json" ]; then
    echo -e "${GREEN}✅ State file created${NC}"
    echo "Content:"
    cat "$HOME/.claude/MEMORY/STATE/todo-state.json" | head -20
else
    echo -e "${RED}❌ State file not created${NC}"
fi

echo ""
echo ""

# Test 2: Test TodoRecovery with saved state
echo -e "${YELLOW}Test 2: TodoRecovery with saved state${NC}"
echo "-------------------------------------------"

# Test SessionStart event
START_INPUT=$(cat << EOF
{
  "session_id": "test-session-456",
  "transcript_path": "/tmp/empty.jsonl",
  "hook_event_name": "SessionStart"
}
EOF
)

# Create empty transcript
echo '{"type":"message","role":"user","content":"开始"}' > /tmp/empty.jsonl

echo "$START_INPUT" | bun ~/.claude/hooks/TodoRecovery.hook.ts 2>&1 | head -30

echo ""
echo ""

# Test 3: Test with all todos completed
echo -e "${YELLOW}Test 3: TodoEnforcer with all todos completed${NC}"
echo "-------------------------------------------"

# Create a mock transcript with all completed
cat > "$MOCK_TRANSCRIPT" << 'EOF'
{"type":"message","role":"user","content":"帮我实现用户认证"}
{"type":"tool_use","tool_name":"TodoWrite","tool_input":{"todos":[{"id":"1","content":"实现登录","status":"completed","priority":"high"}]}}
{"type":"message","role":"assistant","content":"完成！"}
EOF

echo "$STOP_INPUT" | bun ~/.claude/hooks/TodoEnforcer.hook.ts 2>&1 | head -20

# Check if state was cleaned up
if [ -f "$HOME/.claude/MEMORY/STATE/todo-state.json" ]; then
    echo -e "${YELLOW}⚠️  State file still exists (should be cleaned)${NC}"
else
    echo -e "${GREEN}✅ State file cleaned up${NC}"
fi

echo ""
echo ""

# Test 4: Test with no TodoWrite
echo -e "${YELLOW}Test 4: TodoEnforcer with no TodoWrite${NC}"
echo "-------------------------------------------"

# Create a mock transcript without TodoWrite
cat > "$MOCK_TRANSCRIPT" << 'EOF'
{"type":"message","role":"user","content":"你好"}
{"type":"message","role":"assistant","content":"你好！"}
EOF

echo "$STOP_INPUT" | bun ~/.claude/hooks/TodoEnforcer.hook.ts 2>&1 | head -20

echo ""
echo ""

# Test 5: Test TodoRecovery with no state
echo -e "${YELLOW}Test 5: TodoRecovery with no state${NC}"
echo "-------------------------------------------"

# Clean up state first
rm -f "$HOME/.claude/MEMORY/STATE/todo-state.json"

echo "$START_INPUT" | bun ~/.claude/hooks/TodoRecovery.hook.ts 2>&1 | head -20

echo ""
echo "================================"
echo -e "${GREEN}Testing complete!${NC}"
echo ""
echo "Next steps:"
echo "1. Review the test output above"
echo "2. Check state file: cat ~/.claude/MEMORY/STATE/todo-state.json"
echo "3. Try a real session in Claude Code"
echo "4. Verify tab title changes (yellow = pending tasks)"
echo "5. Verify voice notifications (if Voice Server is running)"

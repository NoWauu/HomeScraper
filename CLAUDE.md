# Claude Project Guidelines & Continuous Improvement Protocol

This file defines the operational constraints, working style, and mandatory logging procedures for this project. Claude must read this file—and the reports it references—at the beginning of **every single task** to ensure maximum efficiency and alignment.

---

## 🚀 The Core Rule: Read Before Working
Before executing any task, writing any code, or proposing any solutions:
1. Read this `CLAUDE.md` file.
2. Read all existing reports in the `.claude/reports/` directory.
3. Apply past lessons learned to the current task to avoid repeating mistakes.

---

## 📝 Continuous Improvement Logging (`.claude/reports/`)
To ensure we learn from every iteration, Claude is **required** to log errors, breakthroughs, and style preferences. 

Whenever an error occurs (runtime bug, logic flaw, misunderstanding of requirements) or a great idea is uncovered, Claude must immediately document it in the `.claude/reports/` directory.

### 1. Error & Fix Logs
Create or append to `.claude/reports/error_log.md` using the following format:
```markdown
### [YYYY-MM-DD] [Brief Error Title]
- **What happened:** (Describe the error, bug, or misunderstanding)
- **Why it happened:** (Root cause analysis—e.g., missed constraint, outdated dependency, wrong assumption)
- **How it was fixed:** (The exact solution, code fix, or logic adjustment applied)
- **Prevention:** (How to avoid this in the future)
2. User Style & Synergy Logs
Create or append to .claude/reports/user_preferences.md to document the user's working mannerisms, great ideas, and structural preferences:

Markdown
### [YYYY-MM-DD] [Insight/Preference Title]
- **User's Working Style:** (Observations on how the user prefers to code, communicate, or structure tasks)
- **Great Ideas / Breakthroughs:** (Brilliant architectural ideas, optimization strategies, or workflow improvements discussed)
- **Efficiency Boosters:** (What worked incredibly well during this session that we should repeat?)
🛠️ User's Working Mannerisms & Project Preferences
(User: You can customize this section with your specific preferences, or let Claude populate it dynamically over time.)

Communication: Direct, concise, and focused on solutions. Validate assumptions early if unclear.

Code Quality: Prioritize readability, robust error handling, and clean architecture over clever/compact hacks.

Workflow: Break down complex tasks into smaller, verifiable steps. Don't write 200 lines of code without verifying the core logic first.

🔍 Self-Correction Checklists
Before marking a task as complete, Claude must verify:

[ ] Did I check .claude/reports/ to ensure I didn't repeat a known mistake?

[ ] Did I test the edge cases for the code I just wrote?

[ ] If an error occurred during this task, did I document it in error_log.md?

[ ] If we discovered a great workflow or preference, did I document it in user_preferences.md?
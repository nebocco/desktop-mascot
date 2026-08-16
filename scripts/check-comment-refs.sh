#!/usr/bin/env bash
# Detect code comments that reference external documents or tickets
# (e.g. "issue 12", "ADR-003", "Phase 1", "Task 2.1", "PR #1").
# Comments must be self-contained: explain the reasoning in place instead
# of pointing to other files. Usage: check-comment-refs.sh [file...]
set -u

# コメント行に限定して誤検知を抑える。行頭の`*`はブロックコメント内部、
# 行頭の`#`はシェルスクリプト用。マーカーの無いブロックコメント内部行は
# 検出できないが許容する。
comment_marker='(//|/\*|<!--|^[[:space:]]*\*|^[[:space:]]*#)'
forbidden_ref='(\b(issue|adr|phase|task|pr)[ #-]{0,2}[0-9]|(フェーズ|タスク)[0-9])'

status=0
for file in "$@"; do
    [ -f "$file" ] || continue
    if grep -nHiE "${comment_marker}.*${forbidden_ref}" -- "$file"; then
        status=1
    fi
done

if [ "$status" -ne 0 ]; then
    echo "error: comments must be self-contained; do not reference issues, ADRs, phases, tasks or PRs by number." >&2
    echo "Write the reasoning briefly in place instead." >&2
fi
exit "$status"

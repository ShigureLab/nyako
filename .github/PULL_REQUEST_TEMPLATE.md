## Why

This PR introduces a structured knowledge management system for Nyako to improve its ability to organize, maintain, and review knowledge systematically. As Nyako accumulates more knowledge, it becomes essential to have a well-defined standard for storing, verifying, and retrieving knowledge efficiently.

## What

### Files Modified

- `skills/nyako/rules/knowledge.md` - Enhanced with detailed requirements for knowledge organization and review

### New Features Added

1. **Standardized Directory Structure**
   - `~/.nyako/knowledge/technologies/` - Language, frameworks, tools
   - `~/.nyako/knowledge/issues/` - Common issues and bugs
   - `~/.nyako/knowledge/repos/` - GitHub repository-specific knowledge (mandatory path for project knowledge)
   - `~/.nyako/knowledge/best-practices/` - General best practices
   - `~/.nyako/knowledge/archived/` - Outdated or incorrect knowledge

2. **File Format Standard**
   - YAML Frontmatter with metadata (title, tags, confidence, verified_count, last_updated, source)
   - Enforces Markdown format with clear sections

3. **Confidence Lifecycle**
   - **low**: Initial state, unverified information
   - **medium**: Verified 1-4 times, partially trustworthy
   - **high**: Verified 5+ times, best practice

4. **Maintenance Strategy**
   - **Verification & Upgrade**: Increment `verified_count` on successful application
   - **Error Correction**: Move to archived for serious errors
   - **Knowledge Review**: Regular review and organization based on user requests
   - **Reference Tracking**: Record source URLs for validation

### Example Usage

```bash
# Search for specific knowledge
grep -r "useEffect infinite loop" ~/.nyako/knowledge/

# Create new knowledge entry
cat > ~/.nyako/knowledge/technologies/react/useeffect-infinite-loop.md << 'EOF'
---
title: React useEffect Infinite Loop Fix
tags: [react, hooks, bugfix]
confidence: low
verified_count: 0
last_updated: 2026-01-24
source: https://github.com/facebook/react/issues/12345
---

# React useEffect Infinite Loop Fix

## Problem Description

When using `useEffect`...

## Solution

Ensure dependency array is correct...
EOF
```

## How

1. **Structured Organization**: Provides clear guidelines for directory structure and file naming, making knowledge easily discoverable
2. **Quality Control**: Implements confidence levels and verification counts to distinguish between unverified tips and proven best practices
3. **Review Mechanism**: Establishes a systematic approach to knowledge review, including metadata updates and actual file organization
4. **Lifecycle Management**: Automatic archiving of outdated knowledge and regular cleanup of empty directories

## Checklist

- [x] CI is passing
- [x] Code follows the project style guide
- [x] Documentation is updated
- [x] All tests pass locally
- [ ] Unit tests are added
- [ ] Integration tests are added
- [ ] Performance tests are added
- [ ] Examples are added
- [ ] CHANGELOG.md is updated (if needed)

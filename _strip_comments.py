#!/usr/bin/env python3
"""Strip comments from shipped JS/CSS (the files visible in devtools), leaving CODE untouched.

A char-level state machine that understands JS strings, template literals (incl. nested ${}),
regex literals, and both // and /* */ comments (CSS: only strings + /* */). It removes ONLY
comments -- never code -- then collapses the blank lines left behind. Run with file paths:

    python _strip_comments.py js/map.js js/envfx.js css/styles.css ...

Idempotent. Verify the site still works after running (this rewrites the files in place).
"""
import sys

# `/` starts a regex (not division) when the previous significant char is one of these
# (expression position): operators / openers / nothing.
_REGEX_OK = set("(,=:[!&|?{};<>+-*%^~")
# keywords that may be FOLLOWED by a regex literal, so `return /re/`, `typeof /re/`, etc.
# are detected as regex (not division) even though the previous char is a letter.
_REGEX_KW = {"return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
             "do", "else", "yield", "case", "throw", "await"}
_WORD = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$")


def strip_js(src):
    out = []
    i, n = 0, len(src)
    prev = ""                      # last significant (non-space, non-comment) char emitted
    word = ""                      # current identifier/keyword run (for keyword-before-regex)
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ""
        # line comment
        if c == "/" and d == "/":
            while i < n and src[i] != "\n":
                i += 1
            continue
        # block comment
        if c == "/" and d == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        # string
        if c == '"' or c == "'":
            q = c
            out.append(c)
            i += 1
            while i < n:
                out.append(src[i])
                if src[i] == "\\":
                    if i + 1 < n:
                        out.append(src[i + 1])
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            prev = q
            word = ""
            continue
        # template literal (handle nested ${ ... } which may contain ` and comments)
        if c == "`":
            out.append(c)
            i += 1
            depth = 0                       # ${} nesting depth
            while i < n:
                ch = src[i]
                if ch == "\\":
                    out.append(ch)
                    if i + 1 < n:
                        out.append(src[i + 1])
                    i += 2
                    continue
                if depth == 0 and ch == "`":
                    out.append(ch)
                    i += 1
                    break
                if ch == "$" and i + 1 < n and src[i + 1] == "{":
                    out.append("${")
                    depth += 1
                    i += 2
                    continue
                if depth > 0 and ch == "}":
                    out.append(ch)
                    depth -= 1
                    i += 1
                    continue
                out.append(ch)
                i += 1
            prev = "`"
            word = ""
            continue
        # regex vs division
        if c == "/":
            is_regex = (prev == "" or prev in _REGEX_OK or (prev in _WORD and word in _REGEX_KW))
            if is_regex:
                out.append(c)
                i += 1
                inclass = False
                while i < n:
                    ch = src[i]
                    out.append(ch)
                    if ch == "\\":
                        if i + 1 < n:
                            out.append(src[i + 1])
                        i += 2
                        continue
                    if ch == "[":
                        inclass = True
                    elif ch == "]":
                        inclass = False
                    elif ch == "/" and not inclass:
                        i += 1
                        break
                    i += 1
                while i < n and (src[i].isalpha()):     # flags
                    out.append(src[i])
                    i += 1
                prev = "/"
                word = ""
                continue
            out.append(c)
            prev = c
            word = ""
            i += 1
            continue
        out.append(c)
        if not c.isspace():
            prev = c
            word = (word + c) if c in _WORD else ""
        i += 1
    return _collapse_blanks("".join(out))


def strip_css(src):
    out = []
    i, n = 0, len(src)
    while i < n:
        c = src[i]
        d = src[i + 1] if i + 1 < n else ""
        if c == "/" and d == "*":
            i += 2
            while i < n and not (src[i] == "*" and i + 1 < n and src[i + 1] == "/"):
                i += 1
            i += 2
            continue
        if c == '"' or c == "'":
            q = c
            out.append(c)
            i += 1
            while i < n:
                out.append(src[i])
                if src[i] == "\\":
                    if i + 1 < n:
                        out.append(src[i + 1])
                    i += 2
                    continue
                if src[i] == q:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return _collapse_blanks("".join(out))


def _collapse_blanks(text):
    # drop lines that are now empty/whitespace-only (were comment lines); collapse runs to <=1 blank
    lines = text.split("\n")
    res = []
    blank = 0
    for ln in lines:
        if ln.strip() == "":
            blank += 1
            if blank <= 1:
                res.append("")
        else:
            blank = 0
            res.append(ln.rstrip())
    return "\n".join(res).rstrip() + "\n"


if __name__ == "__main__":
    for path in sys.argv[1:]:
        with open(path, encoding="utf-8") as f:
            src = f.read()
        out = strip_css(src) if path.endswith(".css") else strip_js(src)
        with open(path, "w", encoding="utf-8") as f:
            f.write(out)
        print(f"stripped {path}: {len(src)} -> {len(out)} bytes")

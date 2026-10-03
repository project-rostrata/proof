# Security Policy

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting rather than opening a public issue:
**Security → Advisories → Report a vulnerability** on this repository's GitHub page. This
sends the report privately to the repository maintainers only. If you can't use that feature,
open a regular issue asking for an alternative contact method, without describing the
vulnerability itself.

## Scope

proof is a self-hosted application that you run on infrastructure you control. These areas
deserve extra scrutiny in reports:

- **Path handling.** Project names and uploaded filenames become paths on disk. A
  client-supplied string that escapes the user's data directory (path traversal, symlink
  tricks) is a real vulnerability.
- **Upload handling.** Uploads are type-checked by magic bytes and capped in size. A way to get
  a non-image stored as a photo, or to get past the size cap, is in scope.
- **Image decoding.** Crafted JPEG/PNG/EXIF/XMP input that causes excessive memory use, a
  hang, or a crash in the thumbnailer, the EXIF reader, or the XMP parser (for example XML
  external entities) is in scope.
- **Saved edits.** A save uploads a render and a recipe in one framed request. A way to write
  outside the project's `edits/` folder, to store a non-JPEG render, or to overwrite another
  photo's edit is in scope.
- **Authentication and cross-user access.** Accounts use PBKDF2 password hashes and HttpOnly
  session cookies (`SameSite=Lax`, plus `Secure` when `PROOF_SECURE_COOKIES=true`). Bypassing
  login, or reading or modifying another user's projects,
  photos, or edits is in scope.

## Supported versions

There's no formal LTS policy, because this project is pre-1.0. Security fixes land on `main`
and aren't back-ported to older tags.

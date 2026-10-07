# Security

Mori handles recordings and transcripts of private conversations, so reports
about anything that could expose them are taken seriously.

## Reporting a vulnerability

Please do not open a public issue. Use GitHub's private reporting instead:
**Security → Report a vulnerability** on this repository. You will get an answer
within a week.

Useful to include: the version or commit, the operating system, what you did,
what you expected and what happened.

## What counts

- Audio, transcripts or the index leaving the machine when they should not.
- A private call (`session.sensitive = 1`) reaching a model that is not local.
- The API key stored in `~/.mori/mori.db` being exposed to a web origin.
- Anything that lets a web page or a file run code through the app.

## Where Mori keeps things

Everything lives in `~/.mori` (`mori.db`, `audio/`, `backups/`, `export/`,
`models/`). The model API key is stored in that database in clear text and is
protected by the operating system's account and disk encryption, not by Mori.

# Authenticity Notes for LinkedIn

A Chrome extension (Manifest V3) that embeds a Community Notes-style context card
directly below each LinkedIn post, showing a probabilistic AI-generation verdict
with visible, sentence-level evidence — instantly, as the user scrolls.

## Why

LinkedIn is increasingly flooded with AI-generated posts presented as authentic
personal insight. Readers have no fast, in-feed way to gauge an author's implicit
claim of authenticity. This extension adds that context — **as evidence, not an
accusation**: a confidence score plus the specific signals behind it, always paired
with a disclaimer that detectors can be wrong.

## How it works

A two-stage detection pipeline keeps the card instant while still allowing a deeper check:

1. **Stage 1 — instant local verdict (<10ms).** Local stylometric heuristics run in
   the content script the moment a post enters the viewport, and embed the card with
   no network round-trip.
2. **Stage 2 — async deep check (1–2s).** The post text is content-hashed, cached, and
   sent to a pluggable detection API. The embedded card upgrades in place
   (preliminary → verified).

See [`PROJECT_CONTEXT.md`](./PROJECT_CONTEXT.md) for the full problem statement,
product decisions, architecture, UI spec, roadmap, and guiding principles.

## Status

MVP skeleton stage. This repository is being scaffolded — see the roadmap in
`PROJECT_CONTEXT.md`.

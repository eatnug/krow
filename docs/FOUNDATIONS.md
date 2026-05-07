# Foundations

This project is intentionally built from only three inputs.

## 1. Your Philosophy

The governing belief is simple:
- model capability is already strong enough
- the real leverage is orchestration quality

From that follow the core rules:
- one worker per task
- clean task-local context
- split large work before context becomes noisy
- use the filesystem as the shared relay surface
- do not guess; gather evidence
- when clarification is needed, collect the full current missing-information set before asking

## 2. Claude Code Methodology

The project keeps only the methodology that is broadly transferable:
- lead and worker separation
- thin always-loaded global rules
- heavier operational detail pushed into skills or commands
- scoped tool surfaces and coded rails
- isolated worker context instead of one swollen transcript
- synthesis stays with the lead

What matters here is not Claude-specific syntax. It is the discipline of keeping control in code and keeping worker context narrow.

## 3. Runtime Architecture

The project keeps the runtime architecture pattern:
- runtime-agnostic orchestrator core
- explicit state as source of truth
- machine-readable signals
- schema validation before phase transition
- resume from persisted state, not from fragile transcript memory
- adapters and policy outside the core engine

## What This Project Is Not

This project is not a transplant of any prompt pack or workflow brand.

It intentionally excludes other named systems, their vocabulary, and their product-specific mechanics. The goal is a clean original system whose visible structure is explained by the three inputs above.

## Resulting Shape

The resulting shape is:
- philosophy decides what good orchestration means
- Claude-style methodology shapes context, roles, and control rails
- krow runtime architecture shapes state, signals, and validation

That combination produces `krow`.

"""Sentinel Arena AI authoring (PLANO §12, contract docs/live-quiz/CONTRATO-INCREMENTO-2.md).

Pipeline: prompt (versioned, PII-scrubbed, user content delimited) → provider.generate_json
→ per-item schema validation → deterministic rules → dedupe (bank + batch) → blind critic
→ drafts that a human must review before the quiz can be published.
"""

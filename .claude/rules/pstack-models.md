# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Task `model`). Alias entries in a panel list still count toward its fan-out.
# budget: custom (mixed)
feature, refactoring: opus medium
bug-fix: opus medium
perf-issue: opus high
hillclimb: sonnet medium
judgment and prose: opus high
hardest tasks: opus high
how explorer: haiku medium
how explainer: sonnet high
why investigators: sonnet medium
why synthesizer: opus high
reflect tooling: haiku medium
reflect judgment, divergent, synthesizer: opus high
arena runners: opus high, sonnet high
arena cross-judge pool: sonnet high, opus high
swarm workers: sonnet medium
architect runners: opus high, sonnet high
interrogate reviewers: opus high, sonnet high

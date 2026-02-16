# Visualize Optimization Shift

## Objective

Replace the iterative debug points visualization with a clear indicator of how much the optimization shifted the initial state.

## Changes

- Modified `draw()` function in `lagrange.html`.
- Removed the loop that drew yellow dots for `optimizedData.debugPoints`.
- Added code to draw a yellow dotted line connecting the current satellite position (`sat.x`, `sat.y`) to the optimized start position (`optimizedData.startState.x`, `optimizedData.startState.y`).

## Rationale

This provides a cleaner visual cue for "successful optimizations", showing the user exactly where the stable orbit begins relative to their current cursor position, without cluttering the view with intermediate solver steps.

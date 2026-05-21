function buildPrompt(rawQuery) {
    let query = rawQuery.trim();
    let mode = 'cinematic'; // Default mode

    // Check for explicit keywords
    if (query.toLowerCase().startsWith('/raw ')) {
        mode = 'raw';
        query = query.substring(5).trim();
    } else if (query.toLowerCase().startsWith('/cinematic ')) {
        mode = 'cinematic';
        query = query.substring(11).trim();
    }

    if (mode === 'raw') {
        return query;
    }

    // Cinematic (Reprompter) mode
    return `Take the user's idea and transform it into a visually stunning interactive visualization optimized for a 41mm Apple Watch display.

The experience should feel cinematic, futuristic, smooth, spatial, and highly intuitive.

Focus on:
- visual understanding
- depth and dimensionality
- elegant motion
- cinematic lighting
- meaningful particle atmospheres
- premium material rendering
- smooth camera behavior
- interactive exploration using the Digital Crown

Use touch gestures only when they improve usability.

The visualization should not merely display the concept — it should reinterpret it into a beautiful interactive micro-experience that feels alive and immersive.

Prioritize:
- clarity over clutter
- performance over excess
- visual storytelling over technical complexity

The visualization should feel like an interactive micro-experience designed by Apple's Human Interface team and a sci-fi motion designer together.

Generate the best possible self-contained HTML visualization experience for the concept.

USER IDEA: ${query}`;
}

module.exports = { buildPrompt };

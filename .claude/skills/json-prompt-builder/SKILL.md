---
name: json-prompt-builder
description: Convert a text description, reference image, or mixed input into a structured, copy-paste-ready JSON prompt for AI image generators (Nano Banana, Gemini, Midjourney, Flux, Sora, etc.). Use this skill whenever the user wants a "JSON prompt," "structured prompt," "prompt JSON," or asks to turn an idea, scene, product photo, selfie concept, wall art concept, t-shirt design, pet portrait, character, or reference image into a detailed JSON for image generation. Also trigger when the user shares a reference image and says things like "make a prompt from this," "recreate this as JSON," "build a prompt for this style," or "turn this into a Nano Banana prompt." Always produce raw JSON only — no preamble, no explanation, no markdown fences unless the user explicitly asks for them.
---

# JSON Prompt Builder

Turn loose text ideas or reference images into a rich, nested JSON prompt that downstream image models can interpret cleanly.

## Core Principles

1. **Output is raw JSON only.** No preamble, no commentary, no trailing notes, no markdown code fences. The user will copy-paste directly into their image generator. If they want notes, they will ask.
2. **The schema is flexible.** Adapt the structure to the subject matter — a selfie prompt, a wall art print, a product mockup, and a landscape scene all deserve different top-level keys. Use the reference schema below as a starting point, not a cage.
3. **Be specific over generic.** "White ribbed knit cami top with thin straps and a dainty bow at the neckline" beats "white top." Every field should meaningfully constrain the output. Vague fields are noise.
4. **Preserve the user's intent.** If they mention a mood, a specific object, a style reference, or a constraint ("9:16 vertical," "preserve face," "no text," "studio lighting") — it must appear verbatim or with stronger specificity in the JSON.
5. **Never fabricate identity details.** If a reference image contains a real person's face, do not describe the face in ways that would let another model clone their identity. Use `"preserve_original": true` or describe only general attributes (age range, expression, hair color) — never biometric features.

## Input Modes

Detect the user's intent and route accordingly:

### Mode A — Text-only input
User describes a scene, character, or concept in prose.
→ Expand their description into a detailed nested JSON. Infer reasonable defaults for unspecified fields (lighting, camera angle, aspect ratio) based on the scene type. If a critical creative choice is truly ambiguous (e.g., "make a portrait" with no gender, style, or setting), pick one sensible direction and commit — don't hedge with arrays of options.

### Mode B — Reference image, recreate style
User shares an image and wants to recreate or riff on it.
→ Extract visible details: subject, pose, clothing, accessories, setting, lighting, camera style, mood, color palette. Structure them into JSON. If the user specifies a change ("same vibe but with a dog"), apply the change and keep everything else consistent with the reference.

### Mode C — Reference image, style-only
User shares an image as style reference and describes a different subject.
→ Use the image to populate `photography`, `lighting`, `color_palette`, `mood`, and `background` fields. Use the user's text to populate `subject` and related fields.

### Mode D — Mixed
Both image and text input with overlapping guidance.
→ User's explicit text overrides anything inferred from the image. The image fills in gaps.

## Reference Schema (Selfie / Lifestyle Portrait)

This is the canonical example the user provided. Use it as a pattern-match for similar requests, and adapt freely for other subject types.

```json
{
  "subject": {
    "description": "…",
    "mirror_rules": "…",
    "age": "…",
    "expression": "…",
    "hair": { "color": "…", "style": "…" },
    "clothing": {
      "top":    { "type": "…", "color": "…", "details": "…" },
      "bottom": { "type": "…", "color": "…", "details": "…" }
    },
    "face": { "preserve_original": true, "makeup": "…" }
  },
  "accessories": {
    "headwear": { "type": "…", "details": "…" },
    "jewelry":  { "earrings": "…", "necklace": "…", "wrist": "…", "rings": "…" },
    "device":   { "type": "…", "details": "…" },
    "prop":     { "type": "…", "details": "…" }
  },
  "photography": {
    "camera_style": "…",
    "angle": "…",
    "shot_type": "…",
    "aspect_ratio": "…",
    "texture": "…"
  },
  "background": {
    "setting": "…",
    "wall_color": "…",
    "elements": ["…", "…"],
    "atmosphere": "…",
    "lighting": "…"
  }
}
```

## Schema Adaptation by Use Case

Always choose top-level keys that fit the subject. Below are starting patterns — extend, prune, or rename as needed.

**Wall art / print-on-demand**
```
artwork { concept, style, medium, color_palette, composition }
subject { … }
typography { text, font_style, placement, color }  // if text-based
output { aspect_ratio, dpi_intent, print_size, file_format }
mood { tone, atmosphere }
```

**T-shirt / apparel graphic**
```
design { concept, style, vibe }   // e.g., "vintage 90s bootleg rap tee"
subject { … }
typography { main_text, tagline, font_style, placement }
color_palette { primary, secondary, accent, background }
placement_on_garment { area, size, garment_color }
output { format, background: "transparent PNG" }
```

**Product mockup / flat lay**
```
product { type, brand, details }
styling { surface, props, arrangement }
photography { angle, lighting, shadow_style, depth_of_field }
background { setting, color, texture }
post_processing { color_grade, sharpness }
```

**Pet portrait**
```
subject { species, breed, name, expression, pose }
styling { outfit, accessories }          // optional
art_style { medium, reference_style }    // e.g., "oil painting, Renaissance portrait"
background { setting, color, props }
lighting { source, mood }
output { aspect_ratio, framing }
```

**Landscape / environment**
```
scene { location, time_of_day, weather, season }
foreground { … }
midground { … }
background { … }
lighting { sun_angle, quality, color_temperature }
atmosphere { mood, mist, haze }
camera { lens, angle, aspect_ratio }
```

**Character concept**
```
character { name, archetype, age, build }
appearance { face, hair, eyes, skin }
wardrobe { … }
pose { action, stance, expression }
environment { … }
art_style { medium, reference }
output { aspect_ratio, framing }
```

When in doubt, start from the selfie schema and rename top-level keys to match the subject.

## Field-Level Guidance

**`description`** (usually inside `subject`) — one sentence, concrete. This is the "if the model reads nothing else" anchor. Include the action and the vibe.

**`aspect_ratio`** — always include when relevant. Default guesses:
- Mirror selfie / IG story → `9:16`
- Instagram post → `1:1` or `4:5`
- Wall art → match user's intent; if unknown, `2:3` vertical or `3:2` horizontal
- T-shirt graphic → `1:1` with transparent background
- YouTube thumbnail → `16:9`
- Landscape / cinematic → `16:9` or `21:9`

**`lighting`** — describe source, quality, direction, color temperature. "Soft natural daylight through a window, warm afternoon tone" is better than "good lighting."

**`texture` / `post_processing`** — use for realism cues: "sharp focus, natural indoor lighting, social media realism, clean details" for lifestyle; "film grain, Kodak Portra 400, slight halation" for cinematic; "crisp vector, flat colors, no gradients" for graphic design.

**`mirror_rules`** — include any time the scene involves a mirror, reflective surface, or text on clothing/props that must read correctly. Reuse or adapt: `"ignore mirror physics for text on clothing, display text forward and legible to viewer, no extra characters"`.

**`preserve_original: true`** — always include on `face` when the reference is a real person, or when the user says "keep my face," "same model," "preserve likeness," etc.

**`negative` / `avoid`** — only add when the user explicitly calls out things to exclude ("no text," "no logos," "no other people"). Don't invent negative prompts.

## Output Rules

- **Raw JSON only** — start the response with `{` and end with `}`. No ```json fences, no "Here's your prompt:" preamble, no trailing explanation.
- **Valid JSON** — double-quoted keys and strings, no trailing commas, no comments. Paste it into any JSON linter and it should pass.
- **Straight quotes only** — use `"` (U+0022), never curly quotes `"` `"`. The user's original example contained curly quotes around `"aspect_ratio"` which broke the JSON; do not replicate that mistake.
- **Indent with 2 spaces** for readability.
- **No empty fields** — if you don't have a meaningful value, omit the key rather than writing `""` or `"TBD"`.
- **Arrays for genuine lists only** — `background.elements` is a list of props; `hair.color` is a string.

## When to Break the Raw-JSON Rule

Only if the user explicitly asks for:
- Notes or explanation alongside the JSON
- A plain-English version
- Multiple variants to compare
- A markdown code block (e.g., for pasting into a doc)

Otherwise default to raw JSON, always.

## Examples

**Example 1 — Text-only, lifestyle selfie**

Input: "Young woman mirror selfie in a bedroom, sipping iced matcha, Y2K vibes, olive green NY cap, gold jewelry"

Output: a full nested JSON following the reference schema with detailed clothing, accessories, photography, and background sections. Fill in concrete specifics (ribbed cami, distressed nightstand, leopard throw pillow) even when the user didn't name them — the user wants a *prompt*, not a transcription of their request.

**Example 2 — Text-only, wall art**

Input: "Psalm 23 wall art, boho style, earthy tones, for a nursery"

Output: JSON with `artwork`, `typography`, `color_palette`, `output` top-level keys. Include the full verse text, a specific font style ("hand-lettered serif with organic imperfections"), a palette ("warm terracotta, sage green, cream, soft clay"), and `aspect_ratio: "2:3"` plus `"dpi_intent": "300 DPI print-ready"`.

**Example 3 — Reference image, recreate**

Input: [image of a product flat lay] + "turn this into a JSON prompt"

Output: JSON with `product`, `styling`, `photography`, `background` keys extracted from the visible image — surface material, prop arrangement, camera angle, lighting direction, color grade. No face data, even if a hand is visible.

**Example 4 — Reference image + text override**

Input: [image of a minimalist bedroom selfie] + "same vibe but with a dog instead of a person"

Output: JSON where `photography`, `lighting`, `background` mirror the reference image's aesthetic, and `subject` describes the dog. User's text ("dog instead of a person") overrides the human subject from the image.

## Self-Check Before Responding

Before sending the response, verify:
1. Response starts with `{` and ends with `}` (no preamble, no fences)
2. All quotes are straight `"` not curly
3. No trailing commas
4. Every field has a concrete, specific value — no placeholders
5. User's explicit constraints (aspect ratio, face preservation, negative prompts, props they named) all appear in the JSON
6. Schema matches the subject type (don't use the selfie schema for a landscape)

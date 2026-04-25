# Typography Guide

This guide defines the standard typography for the Savant application to ensure consistency and readability across all UI components.

## Font Families

*   **Primary Font (UI Text):** Inter, sans-serif
    *   *Fallback:* Roboto, sans-serif
*   **Secondary Font (Code/Logs):** JetBrains Mono, monospace
    *   *Fallback:* Menlo, Fira Code, monospace

## Typographic Scale

The following scale defines font sizes and their intended use:

| Size Name | Font Size | Usage                                       |
| :-------- | :-------- | :------------------------------------------ |
| `xs`      | `0.5rem`  | Small labels, captions, minor info          |
| `sm`      | `0.75rem` | Standard body text, secondary info          |
| `md`      | `1rem`    | Default text, main content                  |
| `lg`      | `1.25rem` | Subheadings, prominent labels               |
| `xl`      | `1.5rem`  | Main headings, titles                       |
| `xxl`     | `2rem`    | Major section titles, hero elements (rare)  |

## Font Weights

*   **Normal:** `400`
*   **Medium:** `500`
*   **Semi-Bold:** `600`
*   **Bold:** `700`

## Line Height

*   **Body Text:** `1.5`
*   **Headings:** `1.2`
*   **Code/Preformatted Text:** `1.4`

## Usage Notes

*   Adhere to the defined font families and scale for all text elements.
*   Use `Inter` for all user-facing text and UI labels.
*   Use `JetBrains Mono` for code snippets, terminal output, and technical logs.
*   Ensure sufficient contrast between text color and background for accessibility.
*   Avoid excessive use of bold or all caps for readability.

## Example CSS Variables (Conceptual)

```css
:root {
  --font-family-primary: 'Inter', sans-serif;
  --font-family-secondary: 'JetBrains Mono', monospace;

  --font-size-xs: 0.5rem;
  --font-size-sm: 0.75rem;
  --font-size-md: 1rem;
  --font-size-lg: 1.25rem;
  --font-size-xl: 1.5rem;
  --font-size-xxl: 2rem;

  --font-weight-normal: 400;
  --font-weight-medium: 500;
  --font-weight-semibold: 600;
  --font-weight-bold: 700;

  --line-height-body: 1.5;
  --line-height-heading: 1.2;
  --line-height-code: 1.4;
}
```

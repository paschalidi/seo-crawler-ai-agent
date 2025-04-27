// Simple Image Style Templates - Predefined style templates for image generation
// This module contains templates that can be combined with user prompts

/**
 * Style template for high-quality render
 * @param subject The main subject of the image
 * @returns A prompt for high-quality render style
 */
export function highQualityRenderStyle(subject: string): string {
  return `high quality render of ${subject}, highly detailed, sharp focus, professional lighting, award-winning photography`;
}

/**
 * Style template for hyperrealistic photography
 * @param subject The main subject of the image
 * @returns A prompt for hyperrealistic photography style
 */
export function hyperrealisticStyle(subject: string): string {
  return `hyperrealistic photography of ${subject}, photorealistic, extremely detailed, professional photography, sharp focus, high resolution, 8k, HDR, dramatic lighting`;  
}

/**
 * Style template for Bauhaus style
 * @param subject The main subject of the image
 * @returns A prompt for Bauhaus style
 */
export function bauhausStyle(subject: string): string {
  return `${subject} in Bauhaus style, geometric shapes, primary colors, minimalist design, clean lines, functional aesthetic, poster art, graphic design, bold typography, red, blue, yellow, black`;  
}

/**
 * Style template for cinematic style
 * @param subject The main subject of the image
 * @returns A prompt for cinematic style
 */
export function cinematicStyle(subject: string): string {
  return `cinematic shot of ${subject}, film photography, dramatic lighting, shallow depth of field, movie scene, professional color grading, widescreen format, high production value`;
}

/**
 * Style template for advertising poster
 * @param subject The main subject of the image
 * @returns A prompt for advertising poster style
 */
export function advertisingPosterStyle(subject: string): string {
  return `advertising poster of ${subject}, professional product photography, clean background, commercial lighting, bold colors, eye-catching composition, marketing material, professional design`;
}

/**
 * Type for style template functions
 */
type StyleTemplateFunction = (subject: string) => string;

/**
 * Available style templates
 */
export const STYLE_TEMPLATES: Record<string, StyleTemplateFunction> = {
  "high-quality-render": highQualityRenderStyle,
  "hyperrealistic": hyperrealisticStyle,
  "bauhaus-style": bauhausStyle,
  "cinematic": cinematicStyle,
  "advertising-poster": advertisingPosterStyle
};

/**
 * Style template names for CLI choices
 */
export const STYLE_TEMPLATE_NAMES = Object.keys(STYLE_TEMPLATES);

/**
 * Applies a style template to a subject
 * @param templateName The name of the template to apply
 * @param subject The main subject for the image
 * @returns A complete prompt with the style applied
 */
export function applyStyleTemplate(
  templateName: string,
  subject: string
): string {
  const template = STYLE_TEMPLATES[templateName];
  if (!template) {
    throw new Error(`Style template "${templateName}" not found`);
  }

  return template(subject);
}
